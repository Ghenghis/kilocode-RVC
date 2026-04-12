import * as crypto from "crypto"
import * as vscode from "vscode"
import { buildCspString } from "./webview-html-utils"

function getNonce(): string {
  return crypto.randomBytes(16).toString("hex")
}

export function buildWebviewHtml(
  webview: vscode.Webview,
  opts: {
    scriptUri: vscode.Uri
    styleUri: vscode.Uri
    iconsBaseUri: vscode.Uri
    title: string
    port?: number
    extraStyles?: string
    /** When true, injects a console bridge that forwards console.* to the extension via kiloDebugConsole messages. */
    consoleBridge?: boolean
  },
): string {
  const nonce = getNonce()
  const csp = buildCspString(webview.cspSource, nonce, opts.port)

  // Console bridge: ALWAYS injected (zero overhead when inactive — just one if-check per call).
  // Initial state is set by consoleBridge option; can be activated at any time via
  // window.__kiloEnableDebugConsole() so mid-session debug enable works without a reload.
  const consoleBridgeScript = `<script nonce="${nonce}">(function(){
  var _en=${opts.consoleBridge ? "true" : "false"};
  var _buf=[];
  var _o={log:console.log,warn:console.warn,error:console.error,debug:console.debug,info:console.info};
  ['log','warn','error','debug','info'].forEach(function(l){
    console[l]=function(){
      _o[l].apply(console,arguments);
      if(!_en)return;
      var a=Array.prototype.slice.call(arguments).map(function(x){
        try{return typeof x==='string'?x:JSON.stringify(x);}catch(e){return String(x);}
      });
      _buf.push({level:l,args:a});
    };
  });
  window.__kiloEnableDebugConsole=function(){_en=true;_flush();};
  window.__kiloDisableDebugConsole=function(){_en=false;_buf=[];};
  function _flush(){
    var api=window.__kiloVsCode;
    if(api&&_buf.length){
      var e=_buf.splice(0);
      e.forEach(function(m){try{api.postMessage({type:'kiloDebugConsole',level:m.level,args:m.args});}catch(_){}});
    }
    if(_en){if(!api){setTimeout(_flush,200);}else if(_buf.length){setTimeout(_flush,50);}}
  }
  if(_en)setTimeout(_flush,200);
})();</script>`

  return `<!DOCTYPE html>
<html lang="en" data-theme="kilo-vscode">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${opts.styleUri}">
  <title>${opts.title}</title>
  <style>
    html {
      scrollbar-color: auto;

      ::-webkit-scrollbar-thumb {
        border: 3px solid transparent !important;
        background-clip: padding-box !important;
      }
    }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      overflow: hidden;
    }
    body {
      background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
    }
    #root {
      height: 100%;
    }${opts.extraStyles ? `\n    ${opts.extraStyles}` : ""}
  </style>
</head>
<body>
  <div id="root"></div>
  ${consoleBridgeScript}
  <script nonce="${nonce}">window.ICONS_BASE_URI = "${opts.iconsBaseUri}";</script>
  <script nonce="${nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`
}
