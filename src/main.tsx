import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './canvas.css'
// Tool definitions are substantial and do not block the first paint. Load
// them in parallel with rendering; they still register as soon as the module
// is ready, before a person can meaningfully interact with the page.
void import('./webmcp/tools').then(({ initWebMCP }) => initWebMCP())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
