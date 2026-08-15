# Issue tracker: GitHub

Issues and specs for this repo live in GitHub repository `lyhu/paseo`. Use the `gh` CLI for all operations. Run commands inside this clone or pass `--repo lyhu/paseo` explicitly.

## Conventions

- Create: `gh issue create --repo lyhu/paseo --title "..." --body "..."`
- Read: `gh issue view <number> --repo lyhu/paseo --comments`
- List: `gh issue list --repo lyhu/paseo --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --repo lyhu/paseo --body "..."`
- Label: `gh issue edit <number> --repo lyhu/paseo --add-label "..."`
- Close: `gh issue close <number> --repo lyhu/paseo --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill conventions

When a skill says “publish to the issue tracker”, create a GitHub issue in `lyhu/paseo`.

When a skill says “fetch the relevant ticket”, read that GitHub issue and its comments.

`/wayfinder` uses one labelled map issue with linked child issues. Prefer GitHub sub-issues and native issue dependencies; use task lists and `Blocked by: #<number>` only when those APIs are unavailable.
