TOOL FAILURE HANDOFF

ROOT CAUSE: The system parses any mention of tool function names (read-file, execute-command, etc) as actual tool invocations, even in file content.

WHAT WORKED: file reading, directory listing, file writing (when content was clean), node -e for ops, direct command format

WHAT FAILED: plan mode respond, attempt completion, ask follow up question, replace in file (intermittent)

FIX: Never mention tool function names in text. Use descriptions like "the file reading function" instead of actual names.

SHELL: Use .cmd extensions, semicolons not &&, node -e for file ops, write output to temp files

PROJECT: Agency OS compiles. One TS error remains. npm run dev to test localhost:3000/login