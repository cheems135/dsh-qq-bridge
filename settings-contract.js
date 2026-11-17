// Shared by the backend and browser. Keep this module free of Node and DOM APIs.
export const API_CONNECTION_TYPES = Object.freeze(['openai', 'anthropic', 'responses', 'runninghub']);

export function deviceCapabilities(device) {
  const mobile = device === 'mobile' || device === 'phone';
  return { apiOnly: mobile, localInference: !mobile, desktopControl: !mobile };
}

// A fixed setting and its obsolete editor belong to the same rule. Changing the
// effective policy must also change what the user is offered in the panel.
export const OPEN_SETTING_RULES = Object.freeze([
  { path: 'phone.enabled', value: true },
  { path: 'phone.autonomous', value: true },
  { path: 'phone.learning', value: true },
  { path: 'realism.safety.phone', value: true, controls: ['rlPhone'] },
  { path: 'realism.unlimitedProactive', value: true, controls: ['rlUnlimited'] },
  { path: 'life.maxTasksPerDay', value: 0, controls: ['lifeBudget'] },
  { path: 'dnd.enabled', value: false },
  { path: 'autonomy.enabled', value: true, controls: ['autoMaster'] },
  { path: 'autonomy.initiate', value: true, selectors: ['[data-auto="initiate"]'] },
  { path: 'autonomy.explore', value: true, controls: ['autoExplore'] },
  { path: 'autonomy.qzoneImages', value: true, controls: ['autoQzoneImages'] },
  { path: 'autonomy.chatIdleMinutes', value: 0, controls: ['autoIdle'] },
  { path: 'autonomy.shareMedia.enabled', value: true, controls: ['shEnabled'] },
  { path: 'autonomy.shareMedia.limits', value: false },
  { path: 'autonomy.shareMedia.voice', value: true, controls: ['shVoice'] },
  { path: 'autonomy.shareMedia.images', value: true, controls: ['shImages'] },
  { path: 'autonomy.shareMedia.duringChat', value: true, controls: ['shDuring'] },
  { path: 'autonomy.shareMedia.idle', value: true, controls: ['shIdle'] },
  { path: 'companion.expressionMode', value: 'free', controls: ['careExpression'] },
  { path: 'companion.casualInitiative', value: true, controls: ['careCasual'] },
  { path: 'companion.maxBubbles', value: 0, controls: ['careBubbles'] },
  { path: 'companion.maxReplyChars', value: 0, controls: ['careChars'] },
].map(rule => Object.freeze({ ...rule, controls: Object.freeze(rule.controls || []), selectors: Object.freeze(rule.selectors || []) })));

// These legacy editors are ignored by the open-mode scheduler. They do not
// rewrite the user's saved local model configuration or sleep schedule.
const OPEN_UNUSED_CONTROLS = Object.freeze(['autoWakeA', 'autoWakeB', 'autoFallbackHours', 'localInitiativeEnabled', 'localInitiativeSave']);

export function openPermissionControls(settings) {
  if (settings?.permissionsMode !== 'open-nonpayment') return { ids: [], selectors: [] };
  return {
    ids: [...OPEN_SETTING_RULES.flatMap(rule => rule.controls), ...OPEN_UNUSED_CONTROLS],
    selectors: OPEN_SETTING_RULES.flatMap(rule => rule.selectors),
  };
}

export function applyFixedOpenSettings(target) {
  for (const { path, value } of OPEN_SETTING_RULES) {
    const keys = path.split('.');
    const field = keys.pop();
    let section = target;
    for (const key of keys) {
      if (!section[key] || typeof section[key] !== 'object' || Array.isArray(section[key])) section[key] = {};
      section = section[key];
    }
    section[field] = value;
  }
  return target;
}
