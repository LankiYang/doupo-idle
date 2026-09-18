// 本地存储的键名集中在这里，只此一处。
//
// 为什么要前缀：浏览器按「协议 + 主机 + 端口」划分 localStorage，**路径不参与**。
// 所以 /doupo/ 与 /doupo-test/ 是同一个源 ⇒ 共用同一份存档，在体验服玩出来的进度会被带回正式服。
// 给体验服的构建加一个键名前缀，两边就彻底各存各的，不用再折腾域名或端口。
//
// ⚠️ 线上构建**不设** VITE_STORAGE_PREFIX，键名与历史逐字节一致。
//    前缀只可能来自构建参数，代码里没有任何「是不是体验服」的运行时判断。
//    改这里之前先想清楚：线上的键名一旦变了，等于把所有玩家的进度清零。
const PREFIX = import.meta.env.VITE_STORAGE_PREFIX || ''

/** 主存档 */
export const SAVE_KEY = `${PREFIX}doupo-idle-save-v1`
/** 主存档的上一份：load() 失败时的回退点，恢复云存档前也会先备份到这里 */
export const SAVE_BAK_KEY = `${PREFIX}doupo-idle-save-v1.bak`
/** 云存档的本地元数据（上次上传时间与指纹），不存进度，丢了只会多传一次 */
export const SAVE_META_KEY = `${PREFIX}doupo-idle-cloud-meta`
/**
 * 消消乐音效开关（v1.40）。**不是进度**：丢了只会把声音恢复成默认的"开"，
 * 不影响存档，也从不参与云同步。加它是新键名 —— 老键名一个没动，不存在迁移。
 */
export const SFX_MUTE_KEY = `${PREFIX}doupo-idle-sfx-mute`
/**
 * 限时联动海报「已经弹过了」的标记（v1.41）。存的是**活动起始时刻**而不是 `1` ——
 * 下次再开新联动时时间戳不同，海报会重新弹一次，不用人工清标记。
 * 同样是**新键**、不是进度：丢了只会让海报再弹一遍，与存档 / 云同步无关。
 */
export const LINK_POSTER_KEY = `${PREFIX}doupo-idle-link-poster`