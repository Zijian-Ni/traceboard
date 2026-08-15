// Color palettes for agents and event types

export const AGENT_COLORS = {
  xiaoluo:  { bg: '#00e5c7', text: '#003d36', label: '小落 / xiaoluo' },
  hermes:   { bg: '#a855f7', text: '#2d0060', label: 'Hermes' },
  dsh:      { bg: '#f59e0b', text: '#3d2600', label: 'DSH' },
  openclaw: { bg: '#00e5c7', text: '#003d36', label: 'OpenClaw' },
}

export const TYPE_COLORS = {
  phase_start:  { bg: '#00e5c7aa', border: '#00e5c7', label: 'phase_start' },
  phase_end:    { bg: '#007a6e88', border: '#007a6e',  label: 'phase_end' },
  agent_call:   { bg: '#a855f7aa', border: '#a855f7', label: 'agent_call' },
  agent_result: { bg: '#38bdf8aa', border: '#38bdf8', label: 'agent_result' },
  error:        { bg: '#f43f5eaa', border: '#f43f5e', label: 'error' },
}

export function getAgentColor(agent) {
  const key = (agent || '').toLowerCase()
  return AGENT_COLORS[key] || { bg: '#38bdf8', text: '#002040', label: agent || 'unknown' }
}

export function getTypeColor(type) {
  const key = (type || '').toLowerCase()
  return TYPE_COLORS[key] || { bg: '#64748b88', border: '#64748b', label: type || 'unknown' }
}

export function agentLabelColor(agent) {
  return getAgentColor(agent).bg
}

export function getAllTypeKeys(events) {
  return [...new Set(events.map(e => e.type || 'unknown'))]
}

export function getAllAgentKeys(events) {
  return [...new Set(events.map(e => e.agent || 'unknown'))]
}
