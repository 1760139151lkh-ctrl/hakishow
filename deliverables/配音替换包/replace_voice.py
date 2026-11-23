#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HakiShow 演示讲解视频 · 配音替换工具

把新声线 1:1 对齐到原旁白的时间槽：整轨模式校正整体与逐句延迟；逐句模式把 40 个短句的发声段
逐一伸缩到原配音同一短句的起止位置（保持音高），与画面大字和 SRT 字幕对齐。随后按原配音逐句匹配响度，
叠加“背景声-无旁白.wav”，按原片相同的母带流程输出。视频画面直接拷贝，不重新编码。

用法（在本文件夹内运行）：
  整轨模式（声线转换得到的整条音频，推荐）：
    python replace_voice.py --full 我的整轨.wav
  逐句模式（按“旁白文本.txt”逐句生成的配音，文件名用编号如 v01.wav、v12.mp3，或行号 01.wav…19.wav）：
    python replace_voice.py --voice-dir 我的配音

依赖：Python 3.8+、numpy（pip install numpy）、ffmpeg（加入 PATH，或用 --ffmpeg 指定；也可 pip install imageio-ffmpeg）。
输出（默认在“输出”文件夹）：新旁白-整轨.wav、新混音.wav、新视频.mp4、对齐报告.md
"""
import argparse, json, os, shutil, subprocess, sys, wave
try:
    import numpy as np
except ImportError:
    sys.exit('缺少 numpy：请先运行  pip install numpy')

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 48000
GAIN = 1.0
EXTS = ('.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma')


def find_ffmpeg(arg):
    for c in (arg, os.environ.get('FFMPEG'), shutil.which('ffmpeg')):
        if c and (os.path.isfile(c) or shutil.which(c)):
            return c
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        sys.exit('找不到 ffmpeg：请安装 ffmpeg 并加入 PATH，或用 --ffmpeg 指定路径（也可以 pip install imageio-ffmpeg）。')


def run(cmd, data=None):
    r = subprocess.run(cmd, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode:
        sys.exit('ffmpeg 出错：\n' + r.stderr.decode('utf-8', 'replace')[-2000:])
    return r.stdout


def decode(ff, path):
    raw = run([ff, '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'])
    return np.frombuffer(raw, '<f4').astype(np.float64)


def read_wav(path):
    with wave.open(path) as w:
        if w.getframerate() != SR or w.getsampwidth() != 2:
            sys.exit('素材格式不符：' + path)
        ch = w.getnchannels()
        a = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float64) / 32768
    return a.reshape(-1, ch)


def write_wav(path, x):
    x = np.asarray(x, dtype=np.float64)
    x = x[:, None] if x.ndim == 1 else x
    with wave.open(path, 'wb') as w:
        w.setnchannels(x.shape[1]); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).round().astype('<i2').tobytes())


def env(x, win=240):
    """滑动平均包络（与 np.convolve(|x|, ones(win)/win, 'same') 等价，但快得多）。"""
    c = np.r_[0, np.cumsum(np.abs(x))]; n = len(x); i = np.arange(n) - (win - 1) // 2
    return (c[np.clip(i + win, 0, n)] - c[np.clip(i, 0, n)]) / win


def trim(x):
    """与原配音相同的裁切规则：峰值归一到 0.9，包络 > 0.004 的首尾各留 10 ms／50 ms。"""
    pk = np.max(np.abs(x)) if len(x) else 0
    if pk <= 0:
        sys.exit('有一句配音是空的（全静音）。')
    x = x / pk * .9
    idx = np.where(env(x) > .004)[0]
    return x[max(0, idx[0] - 480):min(len(x), idx[-1] + 2400)]


def pauses(x):
    """句内停顿：静音段长于 0.14 秒，返回中点（秒）。"""
    q = (env(x) < .004).astype(np.int8)
    d = np.diff(np.r_[0, q, 0])
    s, e = np.where(d == 1)[0], np.where(d == -1)[0]
    keep = (e - s > .14 * SR) & (s > 0) & (e < len(x))
    return [(a + b) / 2 / SR for a, b in zip(s[keep], e[keep])]


def choose(cands, guesses, dur):
    """在停顿候选中按顺序挑出与预估位置最接近的一组（动态规划）；找不到合理匹配返回 None。"""
    m, n = len(guesses), len(cands)
    if m == 0:
        return []
    if n < m:
        return None
    INF = float('inf')
    cost = [[INF] * n for _ in range(m)]; prev = [[-1] * n for _ in range(m)]
    for j in range(n):
        cost[0][j] = abs(cands[j] - guesses[0])
    for i in range(1, m):
        for j in range(i, n):
            for k in range(i - 1, j):
                c = cost[i - 1][k] + abs(cands[j] - guesses[i])
                if c < cost[i][j]:
                    cost[i][j], prev[i][j] = c, k
    j = min(range(m - 1, n), key=lambda jj: cost[m - 1][jj])
    out = []
    for i in range(m - 1, -1, -1):
        out.append(cands[j]); j = prev[i][j]
    out.reverse()
    tol = max(1.0, .2 * dur)
    return out if all(abs(p - g) <= tol for p, g in zip(out, guesses)) else None


def atempo(t):
    parts = []
    while t > 2.0:
        parts.append(2.0); t /= 2.0
    while t < .5:
        parts.append(.5); t /= .5
    parts.append(t)
    return ','.join('atempo=%.6f' % p for p in parts)


def stretch(ff, x, n_out):
    """保持音高的时间伸缩（ffmpeg atempo），并精确到采样点。"""
    if n_out <= 0:
        return np.zeros(0)
    if abs(len(x) - n_out) <= 1:
        y = x.copy()
    else:
        y = np.frombuffer(run([ff, '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-af', atempo(len(x) / n_out), '-f', 'f32le', '-'], x.astype('<f4').tobytes()), '<f4').astype(np.float64)
    y = y[:n_out].copy() if len(y) >= n_out else np.r_[y, np.zeros(n_out - len(y))]
    f = min(240, n_out // 4)
    if f:
        r = np.linspace(0, 1, f); y[:f] *= r; y[-f:] *= r[::-1]
    return y


def level(y):
    """一句话的响度：峰值 2% 以上采样的均方根。"""
    pk = np.max(np.abs(y)) if len(y) else 0
    a = y[np.abs(y) > .02 * pk] if pk > 0 else y[:0]
    return np.sqrt(np.mean(a ** 2)) if len(a) else 0


def set_level(y, ref):
    """把新配音的响度调到与原配音同一句一致（ref 为原配音这一句的片段）。"""
    cur, want = level(y), level(ref) * GAIN
    return y * (want / cur) if cur > 0 and want > 0 else y


def speech_bounds(x, rel=.02):
    """片段里发声的起止（采样点）：包络超过片段峰值 2% 的第一个和最后一个位置，前留 10 ms、后留 30 ms。"""
    e = env(x); m = e.max() if len(e) else 0
    idx = np.where(e > rel * m)[0] if m > 0 else []
    if len(idx) == 0:
        return 0, len(x)
    return max(0, idx[0] - 480), min(len(x), idx[-1] + 1440)


def fit_phrase(ff, new, ref):
    """把新短句的发声段伸缩到原短句发声段的位置和长度上：起点、终点都与原配音（也就是画面字幕）对齐。"""
    out = np.zeros(len(ref))
    r0, r1 = speech_bounds(ref); n0, n1 = speech_bounds(new)
    out[r0:r1] = stretch(ff, new[n0:n1], r1 - r0)
    return out, (n1 - n0) / max(1, r1 - r0)


def onset(v, a, b):
    seg = env(v[a:b]); thr = .03 * (seg.max() if len(seg) and seg.max() > 0 else 1)
    idx = np.where(seg > thr)[0]
    return (a + idx[0]) / SR if len(idx) else None


def lag_between(ref, sig, maxlag):
    """包络互相关估计 sig 相对 ref 的延迟（秒，正值表示 sig 偏晚）。先 10 ms 粗搜，再 1 ms 细搜。"""
    def best(hop, lo, hi):
        e1 = env(ref, hop)[::hop]; e2 = env(sig, hop)[::hop]
        n = min(len(e1), len(e2)); e1, e2 = e1[:n] - e1[:n].mean(), e2[:n] - e2[:n].mean()
        bl, bv = 0, -np.inf
        for L in range(lo, hi + 1):
            v = np.dot(e1[max(0, -L):n - max(0, L)], e2[max(0, L):n - max(0, -L)])
            if v > bv:
                bl, bv = L, v
        return bl
    c = best(480, -int(maxlag * 100), int(maxlag * 100)) * 10
    f = best(48, c - 12, c + 12)
    return f / 1000.0


def main():
    ap = argparse.ArgumentParser(description='HakiShow 演示视频配音替换（1:1 对齐原旁白时间）')
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--full', help='整轨模式：与原片等长的新旁白音频（例如对“原旁白-整轨.wav”做声线转换的结果）')
    g.add_argument('--voice-dir', help='逐句模式：存放逐句配音的文件夹，文件名为编号（v01…v19）或行号（01…19）')
    ap.add_argument('--video', default=os.path.join(HERE, '..', 'HakiShow-演示讲解视频.mp4'), help='原视频（只拷贝画面）')
    ap.add_argument('--out-dir', default=os.path.join(HERE, '输出'), help='输出目录，默认为本文件夹下的“输出”')
    ap.add_argument('--ffmpeg', help='ffmpeg 可执行文件路径（默认从 PATH 或 imageio-ffmpeg 查找）')
    ap.add_argument('--whole-line', action='store_true', help='逐句模式下只按整句变速，不按短句对齐')
    ap.add_argument('--allow-missing', action='store_true', help='逐句模式下缺少的句子保留原配音')
    ap.add_argument('--voice-gain', type=float, default=0.0, help='新配音整体增益（dB），默认 0 表示与原配音同响度')
    ap.add_argument('--no-video', action='store_true', help='只输出音频，不合成视频')
    a = ap.parse_args()
    try:
        sys.stdout.reconfigure(errors='replace')
    except Exception:
        pass

    ff = find_ffmpeg(a.ffmpeg)
    T = json.load(open(os.path.join(HERE, 'timing.json'), encoding='utf-8'))
    global GAIN
    N, K, GAIN = T['samples'], T['stem_scale'], 10 ** (a.voice_gain / 20)
    bg = read_wav(os.path.join(HERE, '背景声-无旁白.wav'))
    orig = read_wav(os.path.join(HERE, '原旁白-整轨.wav'))[:, 0]
    os.makedirs(a.out_dir, exist_ok=True)
    vo = np.zeros(N)
    rows, warns = [], []

    if a.voice_dir:
        files = {}
        for f in os.listdir(a.voice_dir):
            stem, ext = os.path.splitext(f)
            if ext.lower() in EXTS:
                files[stem.lower()] = os.path.join(a.voice_dir, f)
        for L in T['lines']:
            s0, n_line = int(round(L['start'] * SR)), int(round(L['duration'] * SR))
            # 文件名可以是编号（v01、v12…），也可以是行号（1、01、001，对应“旁白文本.txt”的第几行）
            keys = [L['id'].lower(), str(L['index']), '%02d' % L['index'], '%03d' % L['index']]
            path = next((files[k] for k in keys if k in files), None)
            if not path:
                if not a.allow_missing:
                    sys.exit('缺少 %s 的配音文件（%s）。文件名应为 %s.wav／.mp3 等；或加 --allow-missing 保留原配音。' % (L['id'], L['text'], L['id']))
                vo[s0:s0 + n_line] = orig[s0:s0 + n_line]
                rows.append([L['id'], L['text'], L['start'], L['duration'], None, '—', '保留原配音', None]); continue
            x = trim(decode(ff, path))
            src_dur = len(x) / SR
            ph = L['phrases']; bounds = None
            if not a.whole_line and len(ph) > 1:
                tot = sum(len(p['text']) for p in ph); acc = 0; guesses = []
                for p in ph[:-1]:
                    acc += len(p['text']); guesses.append(src_dur * acc / tot)
                bounds = choose(pauses(x), guesses, src_dur)
            ref = orig[s0:s0 + n_line]
            if bounds is not None and len(ph) > 1:
                cuts = [0] + [int(round(b * SR)) for b in bounds] + [len(x)]
                tg = [int(round(p['from'] * SR)) for p in ph] + [n_line]
                fitted = [fit_phrase(ff, x[cuts[i]:cuts[i + 1]], ref[tg[i]:tg[i + 1]]) for i in range(len(ph))]
                y = np.concatenate([f[0] for f in fitted])
                ratios = ['%.2f' % f[1] for f in fitted]
                mode = '按 %d 个短句对齐' % len(ph)
            else:
                y, r = fit_phrase(ff, x, ref); ratios = ['%.2f' % r]
                mode = '按整句对齐' + ('（未识别出与字幕对应的停顿）' if len(ph) > 1 and not a.whole_line else '')
            y = set_level(y, ref)
            vo[s0:s0 + n_line] = y[:n_line]
            bad = [i for i, r in enumerate(ratios) if not (.8 <= float(r) <= 1.25)]
            if bad:
                whole = len(x) / n_line
                if not (.9 <= whole <= 1.1):
                    tip = '建议把这一句重新生成，语速%s约 %d%%' % ('加快' if whole > 1 else '放慢', round(abs(whole - 1) * 100))
                else:
                    tip = '整句语速接近，但%s的节奏与原配音差别较大，建议重新生成时在逗号、句号处停顿得和原配音一样' % '、'.join('“%s”' % ph[i]['text'] for i in bad) if len(ph) > 1 else '建议重新生成这一句'
                warns.append('%s 的变速比例 %s 超出 0.80–1.25，变速可能听得出来；%s。' % (L['id'], '／'.join(ratios), tip))
            rows.append([L['id'], L['text'], L['start'], L['duration'], src_dur, ' / '.join(ratios), mode, None])
    else:
        y = decode(ff, a.full)
        y = y[:N] if len(y) >= N else np.r_[y, np.zeros(N - len(y))]
        lag = lag_between(orig, y, 3.0)
        sh = int(round(lag * SR))
        y = np.r_[y[sh:], np.zeros(sh)] if sh > 0 else np.r_[np.zeros(-sh), y[:N + sh]] if sh < 0 else y
        for L in T['lines']:
            s0, n_line = int(round(L['start'] * SR)), int(round(L['duration'] * SR))
            a0, b0 = max(0, s0 - int(.3 * SR)), min(N, s0 + n_line + int(.3 * SR))
            ll = lag_between(orig[a0:b0], y[a0:b0], .08)
            k = int(round(ll * SR))
            src = y[a0 + k:b0 + k] if 0 <= a0 + k and b0 + k <= N else y[a0:b0]
            seg = set_level(src.copy(), orig[a0:b0])
            fz = 480; seg[:fz] *= np.linspace(0, 1, fz); seg[-fz:] *= np.linspace(1, 0, fz)
            vo[a0:b0] = seg
            rows.append([L['id'], L['text'], L['start'], L['duration'], None, '1.00', '整轨（逐句微调 %+.1f ms）' % (ll * 1000), None])
            if abs(ll) > .04:
                warns.append('%s 与原旁白相差 %.0f ms，声线转换可能改变了节奏，请试听这一句。' % (L['id'], ll * 1000))
        rows.insert(0, ['整体', '', 0, T['total'], None, '', '整体延迟校正 %+.1f ms' % (lag * 1000), None])

    # 逐短句检查：新旧旁白发声的起点、终点之差（毫秒）
    def active(x):
        e = env(x); m = e.max() if len(e) else 0
        idx = np.where(e > .02 * m)[0] if m > 0 else []
        return (idx[0], idx[-1]) if len(idx) else (None, None)
    checks = []
    for L in T['lines']:
        for p in L['phrases']:
            i0, i1 = int(round((L['start'] + p['from']) * SR)), int(round((L['start'] + p['to']) * SR))
            (o0, o1), (n0, n1) = active(orig[i0:i1]), active(vo[i0:i1])
            if o0 is None or n0 is None:
                checks.append([L['id'], p['text'], L['start'] + p['from'], None, None]); continue
            checks.append([L['id'], p['text'], L['start'] + p['from'], (n0 - o0) / SR * 1000, (n1 - o1) / SR * 1000])
    # 实测起点
    for r in rows:
        L = next((x for x in T['lines'] if x['id'] == r[0]), None)
        if L:
            s0 = int(round(L['start'] * SR)); a0, b0 = max(0, s0 - int(.2 * SR)), s0 + int(round(L['duration'] * SR))
            o1, o2 = onset(orig, a0, b0), onset(vo, a0, b0)
            r[7] = None if o1 is None or o2 is None else (o2 - o1) * 1000

    # 输出：新旁白整轨（必剪用）、母带混音、视频
    write_wav(os.path.join(a.out_dir, '新旁白-整轨.wav'), vo)
    mix = (bg + vo[:, None]) / K
    mix = np.tanh(mix * T['master']['softclip_drive']) / np.tanh(T['master']['softclip_drive'])
    mix *= T['master']['peak'] / np.max(np.abs(mix))
    tmp = os.path.join(a.out_dir, '_premaster.wav'); write_wav(tmp, mix)
    mixwav = os.path.join(a.out_dir, '新混音.wav')
    run([ff, '-v', 'error', '-y', '-i', tmp, '-af', 'loudnorm=' + T['master']['loudnorm'], '-ar', str(SR), '-c:a', 'pcm_s16le', mixwav])
    if not a.no_video:
        if not os.path.isfile(a.video):
            sys.exit('找不到原视频：%s（可用 --video 指定，或加 --no-video 只输出音频）' % a.video)
        run([ff, '-v', 'error', '-y', '-i', a.video, '-i', tmp, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
             '-af', 'loudnorm=' + T['master']['loudnorm'], '-c:a', 'aac', '-b:a', '192k', '-ar', str(SR), '-movflags', '+faststart', '-shortest',
             os.path.join(a.out_dir, '新视频.mp4')])
    os.remove(tmp)

    md = ['# 配音替换对齐报告', '', '模式：' + ('逐句（%s）' % a.voice_dir if a.voice_dir else '整轨（%s）' % a.full), '',
          '| 编号 | 目标起点（秒） | 目标时长（秒） | 新素材时长（秒） | 变速比例 | 对齐方式 | 实测起点差（毫秒） | 文本 |', '|---|---|---|---|---|---|---|---|']
    for r in rows:
        md.append('| %s | %.3f | %.3f | %s | %s | %s | %s | %s |' % (r[0], r[2], r[3], '—' if r[4] is None else '%.3f' % r[4], r[5], r[6], '—' if r[7] is None else '%+.0f' % r[7], r[1]))
    md += ['', '变速比例 = 新配音发声时长 ÷ 原配音发声时长（逐短句），1.00 表示不变速；大于 1 表示新配音偏慢、被压短。', '实测起点差是新旧配音第一个音的起点之差（毫秒）。', '']
    ok = [c for c in checks if c[3] is not None]
    if ok:
        smax = max(abs(c[3]) for c in ok); emax = max(abs(c[4]) for c in ok)
        md += ['## 逐短句对齐检查（与画面大字、SRT 字幕对应）', '',
               '共 %d 个短句：发声起点最大偏差 %.1f 毫秒，平均 %.1f 毫秒；发声终点最大偏差 %.1f 毫秒，平均 %.1f 毫秒。60 帧视频一帧约 16.7 毫秒。' % (
                   len(ok), smax, sum(abs(c[3]) for c in ok) / len(ok), emax, sum(abs(c[4]) for c in ok) / len(ok)), '',
               '| 编号 | 字幕开始（秒） | 起点差（毫秒） | 终点差（毫秒） | 短句 |', '|---|---|---|---|---|']
        md += ['| %s | %.3f | %s | %s | %s |' % (c[0], c[2], '—' if c[3] is None else '%+.1f' % c[3], '—' if c[4] is None else '%+.1f' % c[4], c[1]) for c in checks]
        md += ['']
        if smax > 17:
            warns.append('有短句起点偏差超过一帧（%.1f 毫秒），请试听对应位置。' % smax)
    missing = [c[0] + '“' + c[1] + '”' for c in checks if c[3] is None and c[0] in {r[0] for r in rows if r[6] != '保留原配音'}]
    if missing:
        warns.append('这些短句在新配音里没有检测到声音：' + '、'.join(missing))
    md += (['## 需要留意', ''] + ['- ' + w for w in warns]) if warns else ['所有句子的变速比例都在 0.80–1.25 之间。']
    open(os.path.join(a.out_dir, '对齐报告.md'), 'w', encoding='utf-8').write('\n'.join(md) + '\n')
    print('\n'.join(md))
    print('\n完成，输出在：' + os.path.abspath(a.out_dir))


if __name__ == '__main__':
    main()
