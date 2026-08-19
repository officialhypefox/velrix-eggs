# Velrix eggs — working notes

Pelican egg definitions: one JSON file per piece of software the panel can run.

## Read `docs/writing-eggs.md` first

It is the real guide and it is written for this exact job, including a section on handing egg
work to Claude Code without getting something that only looks finished. Do not start from
this file; start from that one.

The two things it will tell you that everything else depends on:

- **An egg runs in two different containers at two different times** (install, then runtime),
  and they are not the same environment. Almost every egg mistake comes from missing that.
- **Runtime eggs and application eggs are written differently.** A runtime egg installs a
  language and gets out of the way; an application egg *is* the application and exposes that
  project's settings as panel variables. "Make an egg for X" almost always means the second.

## Testing and shipping

- Test locally with **Podman** before opening a PR. An egg that has never been run is a
  guess.
- **Panel import is manual.** Merging here does not deploy anything: someone has to import
  the JSON into the panel. Say so when you finish, or the work sits unused.
- Icons are generated: `bun run update-icons` (see `src/icons.json`).
- `bun run type-check` before pushing.

## When packaging an upstream project

Read the project's own docs and start scripts rather than guessing its flags, and prefer the
variables it actually documents over inventing new ones. An egg that exposes a setting the
project ignores is worse than one that exposes nothing.
