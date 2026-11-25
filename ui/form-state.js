// Form values only: no DOM, HTTP, account settings or storage side effects.
export function formScope(snapshot){
  return JSON.stringify([snapshot?.status?.edition==='mobile'?'phone':'desktop',snapshot?.settings?.activeAccountId||'',snapshot?.settings?.activePersonaId||'']);
}
export function sameFormValue(a, b) {
  return a && a.type === 'file' ? !!b && b.type === 'file' && a.signature === b.signature : a === b;
}

export function createFormState() {
  const baselines = {}, drafts = {};
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  function prune(page) {
    if (drafts[page] && !Object.keys(drafts[page]).length) delete drafts[page];
  }
  return {
    baselines, drafts,
    begin(page, values) {
      const previous = baselines[page] || {};
      baselines[page] = { ...values };
      for (const key of Object.keys(drafts[page] || {})) if (owns(previous,key)) baselines[page][key] = previous[key];
      return drafts[page] || {};
    },
    // Refresh from the server without turning its defaults into user edits.
    refresh(page, values) {
      if (!baselines[page]) return;
      for (const [key,value] of Object.entries(values)) if (!owns(drafts[page],key)) baselines[page][key]=value;
    },
    capture(page, current) {
      const base = baselines[page];
      if (!base) return;
      const draft = { ...drafts[page] };
      for (const key of Object.keys(current)) {
        if (!owns(base, key)) continue;
        if (sameFormValue(current[key], base[key])) delete draft[key];
        else draft[key] = current[key];
      }
      drafts[page] = draft;
      prune(page);
    },
    acknowledge(page, submitted, keys, current = null) {
      // A late save response may arrive after the user edits and leaves a page.
      // The retained draft is then the current value, not the old submission.
      for (const key of keys) {
        if (!owns(submitted, key)) continue;
        const latest = current && owns(current, key) ? current[key]
          : owns(drafts[page], key) ? drafts[page][key] : submitted[key];
        if (baselines[page]) baselines[page][key] = submitted[key];
        if (sameFormValue(latest, submitted[key])) {
          if (drafts[page]) delete drafts[page][key];
        } else {
          (drafts[page] ||= {})[key] = latest;
        }
      }
      prune(page);
      if (current) this.refresh(page, current);
    },
    discard(page) {
      delete baselines[page];
      delete drafts[page];
    },
  };
}
