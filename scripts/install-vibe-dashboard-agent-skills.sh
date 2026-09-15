#!/bin/sh
set -eu

source_root="${1:-/opt/vibe-kanban-vscode-web-seed/skills}"
target_home="${2:-/home/vkuser}"
owned_skills="vibe-dashboard-preview-urls"

for skill_name in $owned_skills; do
    source_dir="${source_root}/${skill_name}"
    [ -f "${source_dir}/SKILL.md" ] || {
        printf 'Missing owned skill source: %s\n' "$source_dir" >&2
        exit 1
    }

    for skills_root in "${target_home}/.agents/skills" "${target_home}/.claude/skills"; do
        destination="${skills_root}/${skill_name}"
        staging="${skills_root}/.${skill_name}.install.$$"
        mkdir -p "$skills_root"

        if [ -d "$destination" ] && diff -qr "$source_dir" "$destination" >/dev/null 2>&1; then
            continue
        fi

        rm -rf "$staging"
        mkdir -p "$staging"
        cp -a "${source_dir}/." "$staging/"
        rm -rf "$destination"
        mv "$staging" "$destination"
    done
done

if [ "$(id -u)" = "0" ] && [ -d "$target_home" ]; then
    owner="$(stat -c '%u:%g' "$target_home")"
    for skill_name in $owned_skills; do
        chown -R "$owner" \
            "${target_home}/.agents/skills/${skill_name}" \
            "${target_home}/.claude/skills/${skill_name}"
    done
fi
