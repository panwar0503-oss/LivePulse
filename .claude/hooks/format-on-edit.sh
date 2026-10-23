#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): format the edited file with the project's own Prettier.
# Silent no-op until Node and a local Prettier install exist, so it never blocks or spams edits.
# Never modifies anything except the single file Claude just edited.

command -v node >/dev/null 2>&1 || exit 0

file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path??"")}catch{}})')
[ -n "$file" ] || exit 0

case "$file" in
  *node_modules*|*[/\\].next[/\\]*|*[/\\]dist[/\\]*|*[/\\]coverage[/\\]*) exit 0 ;;
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css) ;;
  *) exit 0 ;;
esac

prettier="${CLAUDE_PROJECT_DIR:-.}/node_modules/.bin/prettier"
[ -f "$prettier" ] || exit 0

"$prettier" --write --log-level warn "$file" >/dev/null 2>&1
exit 0
