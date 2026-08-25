// Pie Tools Millennium Frontend Entry Point (SharedJSContext)
function PluginEntryPointMain() {
  return {
    default: async function () {
      console.log('[PieTools] Frontend entry point loaded.');
    }
  };
}

function ExecutePluginModule() {
  if (window.MILLENNIUM_BACKEND_IPC) {
    const a = PluginEntryPointMain();
    if (!window.PLUGIN_LIST) window.PLUGIN_LIST = {};
    window.PLUGIN_LIST.PieTools = Object.assign(a, {
      __millennium_internal_plugin_name_do_not_use_or_change__: 'PieTools'
    });
    a.default();
    if (typeof MILLENNIUM_BACKEND_IPC !== 'undefined' && MILLENNIUM_BACKEND_IPC.postMessage) {
      MILLENNIUM_BACKEND_IPC.postMessage(1, { pluginName: 'PieTools' });
    }
  } else {
    PluginEntryPointMain().default();
  }
}

ExecutePluginModule();
