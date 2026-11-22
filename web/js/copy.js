/** 共用的英语界面文案：友好、简洁，便于在手机上快速阅读。将重复使用的操作名称和标签集中放在这里，确保各个页面用词一致。 */
export const T = {
  brand: 'HakiShow',
  slogan: '一张自拍，全新肖像。',

  // 主要创作模式。
  live: '实时相机',
  studio: '照片工作室',

  // 核心操作。
  go: '开始创作',
  same: '试试这个风格',
  another: '换个风格',
  tweak: '调整细节',
  hold: '按住查看原图',
  retake: '重拍',
  save: '保存图片',
  tiktok: '分享',
  again: '再创作一张',
  retry: '重试',
  cancel: '取消',
  upload: '上传照片',
  change: '更换照片',
  sample: '试用示例',
  back: '返回',
  close: '关闭',
  done: '完成',
  gallery: '作品库',
  me: '个人中心',
  fav: '收藏',
  faved: '已收藏',
  del: '删除',
  shoot: '拍照',
  undo: '撤销',
  redo: '重做',
  undone: '已撤销',
  redone: '已重做',
  fold: '收起',

  // 实时工具栏。
  flip: '翻转',
  strength: '强度',
  compare: '对比',
  toStudio: '编辑',

  // 创作控制项。
  knobs: { strength: '风格强度', likeness: '相似度保留', richness: '细节程度', beauty: '美颜' },
  tabs: { style: '风格', tune: '调整', detail: '细节' },
  format: { avatar: '方形 1:1', portrait: '竖幅 2:3' },
  pace: { quick: '快速', fine: '精细', deep: '超精细' },
  paceLine: { quick: '快速预览初步效果', fine: '兼顾速度与细节', deep: '更多细节，稍多一点时间' },
  words: '补充细节',
  wordsHint: '试试：红色缎带，或背景中的烟花……',

  // 进度与反馈。
  stages: ['正在识别肖像特征', '正在塑造光影与风格', '正在细化艺术细节'],
  waits: ['正在寻找你的新形象……', '正在让风格鲜活起来……', '正在完成最后的修饰……', '你的肖像即将完成……'],
  sending: '正在上传照片……',
  queued: '正在排队，很快就轮到你。',
  doneSaved: '已自动保存到作品库',
  replies: ['做好啦！看看怎么样 ✨', '已更新，看看效果怎么样？', '你的新肖像已完成。', '全部完成，快来看看！', '工作室新鲜出炉，尽情欣赏！'],
  seeIt: '查看图片',
  stopped: '已取消，你的照片和设置仍然保留。',
  failed: '这次尝试未能完成',
  tipLight: '为获得最佳效果，请使用光线均匀的正面照片。',
  tipNoFace: '未找到清晰的人脸，要换一张照片吗？',
  tipGood: '人脸清晰、光线良好，可以开始创作。',
  preview: '本地预览 · 连接工作室后可生成智能肖像',
  example: '示例作品 · 连接工作室后可使用自己的照片',
  simulated: '模拟结果 · 用于流程测试',
  saved: '图片已保存',
  savedDl: '图片已下载，请在下载文件夹中查看。',
  shareTip: '图片已保存，请在 TikTok 中选择它，分享你的形象。',
  copied: '已复制',

  // 相机。
  camAsk: '开启相机，试试全新形象。',
  camOn: '开启相机',
  camDenied: '无法使用相机，你可以上传照片。',
  camNone: '此设备未检测到相机，请上传照片开始体验。',
  camStarting: '正在启动相机……',
  faceLost: '请将脸部移入取景框',
  faceOk: '已跟踪人脸',

  // 空状态。
  emptyGallery: '作品库正等着你的创作',
  emptyGalleryLine: '选择风格，再拍摄或上传照片，你的作品将显示在这里。',
  emptyFavs: '暂时没有收藏，点击喜欢的风格上的爱心即可收藏。',
  noPhoto: '先选一张照片',
  noPhotoLine: '光线均匀的正面照片效果最好。',

  // 账户。
  guest: '访客',
  guestLine: '作品保存在此设备上，登录后可将作品加入账户。',
  memberLine: '你的作品会跨设备同步到私人空间。',
  signIn: '登录',
  signUp: '注册账户',
  signOut: '退出登录',
  handle: '用户名',
  password: '密码',
  nickname: '显示名称',
  handleHint: '3–20 位小写字母或数字',
  pwHint: '至少 6 个字符',
  welcomeBack: '欢迎回来',
  joined: '账户已创建，你的作品已准备就绪。',
  merged: (n) => `已将 ${n} 项访客${n === 1 ? '内容' : '内容'}添加到你的账户`,
  offlineAccount: '演示作品保存在此设备上，连接工作室后可使用账户和跨设备同步。',
};

/** 适用于强度等滑块的友好等级标签。 */
export const level = (/** @type {number} */ v) => (v < 25 ? '轻微' : v < 50 ? '中等' : v < 75 ? '较强' : '最强');
