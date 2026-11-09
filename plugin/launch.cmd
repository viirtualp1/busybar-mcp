@echo off
rem Starts the BUSY Bar MCP server with the Node that Codex or the system provides.
if defined CODEX_MCP_NODE_PATH if exist "%CODEX_MCP_NODE_PATH%" ("%CODEX_MCP_NODE_PATH%" "%~dp0server.mjs" %* & exit /b)
where node >nul 2>nul && (node "%~dp0server.mjs" %* & exit /b)
echo BUSY Bar: Node.js was not found. Install it from https://nodejs.org and restart Codex. 1>&2
exit /b 127
