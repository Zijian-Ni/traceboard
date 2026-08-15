// Traceboard i18n — EN / 中文

export const strings = {
  en: {
    tagline: 'Agent Trace Player',
    hero_title1: 'See what your agents',
    hero_title2: 'actually did.',
    hero_sub: 'Drop a JSONL trace file, or load the live demo below.',
    drop_label: 'Drop trace.jsonl here',
    drop_hint: 'or click to browse',
    load_demo: 'Load Live Demo',
    demo_hint: 'Real trace from a 3-agent aurora orchestra run',
    share: 'Share',
    export: 'Export',
    filter_by: 'Filter:',
    reset: 'Reset',
    back_to_hero: '← Load another',
    field_agent: 'Agent',
    field_phase: 'Phase',
    field_time: 'Time',
    field_duration: 'Duration',
    field_message: 'Message',
    field_raw: 'Raw JSON',
    toast_copied: '🔗 URL copied to clipboard',
    toast_export: '📄 Snapshot exported',
    toast_loaded: '✅ Trace loaded',
    toast_share_small: '⚠️ Trace too large for URL sharing (max 50 events)',
    no_trace: 'No matching events',
    events: 'events',
    agents: 'agents',
    duration: 'duration',
    share_title: 'Share this trace',
    share_note: 'URL encodes up to 50 events as base64',
  },
  zh: {
    tagline: '代理轨迹播放器',
    hero_title1: '亲眼看看你的 Agent',
    hero_title2: '到底干了什么。',
    hero_sub: '拖入 JSONL 轨迹文件，或加载下方实时演示。',
    drop_label: '拖入 trace.jsonl',
    drop_hint: '或点击浏览文件',
    load_demo: '加载实时演示',
    demo_hint: '真实的三代理极光乐队运行轨迹',
    share: '分享',
    export: '导出',
    filter_by: '筛选:',
    reset: '重置',
    back_to_hero: '← 加载其他',
    field_agent: '代理',
    field_phase: '阶段',
    field_time: '时间',
    field_duration: '耗时',
    field_message: '消息',
    field_raw: 'JSON 原始数据',
    toast_copied: '🔗 链接已复制',
    toast_export: '📄 快照已导出',
    toast_loaded: '✅ 轨迹已加载',
    toast_share_small: '⚠️ 轨迹过大无法用 URL 分享（最多 50 条）',
    no_trace: '无匹配事件',
    events: '条事件',
    agents: '个代理',
    duration: '总耗时',
    share_title: '分享此轨迹',
    share_note: '最多编码 50 条事件为 base64 URL',
  }
}

export let currentLang = 'en'

export function setLang(lang) {
  currentLang = lang
  document.documentElement.setAttribute('data-lang', lang)
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')
    if (strings[lang][key] !== undefined) {
      el.textContent = strings[lang][key]
    }
  })
}

export function t(key) {
  return strings[currentLang][key] || strings['en'][key] || key
}
