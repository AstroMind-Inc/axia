// Models available in the playground.
//
// `api_required` controls whether the UI hides the model when no api_url is
// configured. In axia the model server is OPTIONAL — both models below run
// against OpenAI for their main reasoning, and only fall back to the
// fine-tuned model server for the Event Analyst step when one is configured.
// Hence both are flagged api_required: false. Set `api_required: true` if
// you want the UI to enforce a model-server URL.
export const MODEL_OPTIONS = [
    { value: "astromind-openai", label: "Astromind OpenAI", api_required: false, supports_event_list: false },
    { value: "astromind-multi-agent", label: "Astromind Multi-Agent", api_required: false, supports_event_list: true }
];
