# Writing Velrix eggs

This is the working guide for anyone adding or changing an egg in this repo. It
covers what an egg actually is, how to read an upstream project well enough to
package it, how to write and test one locally with Podman, and how to hand the
job to Claude Code without getting something that only looks finished.

Read the first two sections even if you are in a hurry. Almost every mistake
people make with eggs comes from not understanding the two-container split.

## What an egg is

An egg is a single JSON file that tells the Pelican panel how to run one piece of
software. It answers four questions:

1. **What image does it run in?** (`docker_images`)
2. **How do the files get there?** (`scripts.installation`)
3. **What command starts it?** (`startup`)
4. **What can the user configure?** (`variables`)

Everything else in the file is metadata or small behavioural hints, like how to
tell that the server finished booting.

We have two kinds of egg in this repo, and they are written differently:

- **Runtime eggs** (`python.json`, `nodejs.json`, `bun.json`, `go.json`,
  `java.json`, `rust.json`). The user brings their own code from a Git repo.
  The egg installs a language runtime and gets out of the way.
- **Application eggs** (`red-discordbot.json`, `modmail.json`). The egg *is* the
  application. It knows the project, installs it, and exposes that project's
  settings as panel variables.

This guide is mostly about application eggs, because that is what "make an egg
for X" almost always means.

## The two containers

This is the part that catches everyone.

An egg runs in **two different containers at two different times**, and they do
not share a filesystem except for one directory.

| | Install time | Run time |
|---|---|---|
| Image | `scripts.installation.container` | one of `docker_images` |
| User | root | uid 1000, named `container` |
| Server volume is at | `/mnt/server` | `/home/container` |
| `$HOME` | whatever the image sets | `/home/container` |
| Lives for | one install | as long as the server runs |

The volume is the *same directory*. Only the path differs. Nothing you install
outside that directory survives, which has one large consequence:

> **You cannot `apt-get install` anything at run time.** If the software needs a
> system library, that library has to already be in the runtime image, or the egg
> cannot use that image.

The second consequence is about paths. Anything that writes down an **absolute
path** during install writes down `/mnt/server/...`, which does not exist when
the server boots. Two ways out:

- **Make the path resolve at run time.** `pip install --user` puts packages in
  `$HOME/.local`, and `$HOME` is whatever the current container says it is. Set
  `export HOME=/mnt/server` in the install script and the packages land in the
  right place under both names. This is what `modmail.json` does.
- **Make `/mnt/server` and `/home/container` the same path.** Symlink
  `/home/container` to `/mnt/server` during install, so anything that records
  `/home/container` is already correct. This is what `red-discordbot.json` does,
  because `redbot-setup` bakes an absolute data path into a config file and pip
  writes absolute interpreter paths into console scripts.

Use the first approach unless the software forces the second.

### How the startup command runs

The runtime image's entrypoint reads the `STARTUP` environment variable, rewrites
`{{VAR}}` into `${VAR}`, prints it, and `eval`s it with every server variable
present in the environment.

Three things follow:

- It is a **bash line**, not an argv list. Quoting matters, `;` separates
  commands, and you can use `if`, `for` and pipes.
- `{{MY_VAR}}` and `$MY_VAR` both work. Prefer `{{MY_VAR}}` for egg variables so
  the panel's startup editor highlights them.
- **Every variable is injected, including the empty ones.** A variable with an
  empty default arrives as an empty string, not as "unset". This matters more
  than it sounds like it does. See the section on empty variables below.

## Anatomy of an egg file

Copy the field order from an existing egg. The panel exports them in a
particular order and diffs are easier to read when we match it.

```jsonc
{
  "_comment": "DO NOT EDIT: FILE GENERATED AUTOMATICALLY BY PANEL",
  "meta": {
    "version": "PLCN_v2",
    "update_url": "https://raw.githubusercontent.com/officialhypefox/velrix-eggs/refs/heads/main/eggs/<name>.json"
  },
  "exported_at": "2026-08-09T00:00:00+00:00",
  "name": "Modmail",
  "author": "contact@velrix.net",
  "uuid": "<generate a fresh one>",
  "description": "One or two sentences a user reads before clicking install.",
  "tags": ["discord", "bot", "python"],
  "features": [],
  "docker_images": { "Python 3.11": "ghcr.io/pelican-eggs/yolks:python_3.11" },
  "file_denylist": [],
  "startup": "…one bash line…",
  "config": { "files": "{}", "startup": "…", "logs": "{}", "stop": "^C" },
  "scripts": { "installation": { "script": "…", "container": "…", "entrypoint": "bash" } },
  "variables": [ … ]
}
```

Field notes, in the order that matters:

**`uuid`** must be unique and must never change. It is how the panel recognises an
egg it has already imported, so keeping it stable is what makes the update button
update rather than duplicate, and reusing another egg's UUID overwrites that egg.
Generate one with `cat /proc/sys/kernel/random/uuid`.

**`meta.update_url`** points at the raw file on `main`. It is what makes the
panel's "update egg" button work, so it must match the filename you commit.

**`docker_images`** is a map of display label to image. Keys show up in a
dropdown in the panel. **Only list images the egg genuinely works on.** For
application eggs this is usually exactly one, because the install script hardcodes
a matching installer image (see the Python version trap below).

**`startup`** is the bash line described above.

**`config.startup`** is a JSON string containing `{"done": ["…"]}`. The panel
watches console output and marks the server **running** when it sees one of these
substrings. Pick a line the software only prints when it is genuinely up, not
when it merely started booting. Modmail prints `Logged in as:` only after the
database check and the guild check both pass, which is why that is the marker.

Getting this wrong is not cosmetic. A marker that never appears leaves the server
stuck on "starting" forever; a marker that appears too early makes the panel claim
a broken server is healthy.

**`config.stop`** is what the panel sends on Stop. `^C` means SIGINT, which is
right for anything that handles Ctrl-C cleanly. Game servers usually take a
console command instead, like `stop` or `quit`.

**`config.files`** lets the panel rewrite values inside a config file on the
server. None of our eggs use it, because passing configuration through environment
variables is simpler and leaves the user's files alone. Reach for it only when the
software refuses to read its config from the environment.

**`config.logs`** and **`features`**: empty in every egg we have. `features` turns
on panel-side UI for specific games (Minecraft EULA prompts and similar) and is
not relevant to anything we ship.

**`file_denylist`** hides files from the file manager. Empty everywhere so far.
It is not a security boundary, just clutter reduction.

**`scripts.installation.entrypoint`** is `bash` for every script we write.

## Before you write anything: reading the upstream repo

Clone it into a scratch directory and spend twenty minutes reading. You are
looking for answers to a fixed list of questions. Using Modmail as the worked
example:

**1. How is it meant to be deployed?** Read `Dockerfile`, `docker-compose.yml`,
`Procfile`, `app.json`, `runtime.txt`, any `*.sh` in the root. Modmail's
Dockerfile said Python 3.11 and `apt-get install libcairo2`, which told us the
language version and the one native library it needs, before we read a line of
Python.

**2. What does it depend on that is not code?** Databases, message brokers,
external APIs. Modmail's `docker-compose.yml` has a `mongo` service, and
`app.json` marks `CONNECTION_URI` required. There is no way to run MongoDB inside
a game container, so that became a required variable pointing at something the
user hosts elsewhere. **Find this out first.** If the answer is "it needs a
database", the egg's shape is decided.

**3. How does it read configuration?** Modmail's `core/config.py` calls
`load_dotenv()` and then pulls anything matching a known key straight out of
`os.environ`. That is the ideal case: panel variables named exactly like the
project's env vars just work, and the egg writes no files at all. If instead the
project only reads a YAML or JSON file, you either generate that file in the
install script or use `config.files`.

**4. Which values are required, and what happens when one is blank?** Read the
parsing code, not just the docs. Modmail does
`set(map(int, str(owner_ids).split(",")))` on `OWNERS`, so an empty string reaches
`int("")` and takes the process down at boot. That single line is why the startup
command unsets empty variables.

**5. What does it print when it is actually ready?** Grep the source for the
log line, and check *where in the boot sequence* it sits. That is your
`config.startup.done`.

**6. Does it try to update itself?** Modmail has an autoupdate loop that it
disables when it detects Docker. Setting `USING_DOCKER=yes` makes it stand down
and lets the egg own updates through `git pull` at boot, which is both honest
about the environment and avoids two update mechanisms fighting.

**7. Does it hardcode absolute paths, or write outside its own directory?**
Search for `os.path`, `~`, `/opt`, `expanduser`. This is where the
`/mnt/server` vs `/home/container` problem bites.

**8. What does the user have to do outside the panel?** Discord privileged
intents, an API key, a DNS record, a database. Every one of these belongs in a
variable description, because that is the only documentation most users will read.

## The install script

House rules, all of which exist because of something that actually went wrong:

**Start with `set -euo pipefail`.** A failed install that exits 0 produces a
server that is broken in a way nobody can diagnose from the panel.

**Keep the log short.** `apt-get -qq` with `DEBIAN_FRONTEND=noninteractive`,
`pip --progress-bar off --disable-pip-version-check`, `git -q`. Errors still
print. Nobody reads a successful install log, and everybody reads a failing one,
so noise costs more than it saves.

**Do not install a compiler unless something needs one.** `build-essential` is a
large download and hundreds of log lines. Check first: if pip prints
"Building wheel for …" for a package that has no wheel on the target platform,
add it back, and say so in a comment.

**Do not let package caches land on the volume.** `$HOME` is the user's server
directory, so `pip` writes its cache into their files and charges their disk quota
for a cache that is discarded with the container. `--no-cache-dir`.

**Tell git the volume is safe, through the environment.** The script runs as root
and the volume belongs to the node's container user, so git treats it as
"dubious ownership" and refuses every command against it, including the `git init`
you were about to run. Set the exception like this, before the first git call:

```bash
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0=/mnt/server
```

Not `git config --global`. If the script repoints `HOME` at the volume, and most
of ours do, git's "global" config moves with it, so the exception ends up in a
file git has stopped reading and the install fails exactly as if it were never
set. The environment form does not care where `HOME` points.

**Leave the files owned by the volume's user.** Everything the script writes is
owned by root, and the server runs as somebody else. The volume's own directory
already carries the right ownership, so copy it downward instead of guessing a
uid:

```bash
chown -R --reference=/mnt/server /mnt/server
```

Wings chowns after an install, so on a healthy node this is a no-op that costs one
pass over the tree. It is worth having anyway: a first boot that cannot write its
own log directory is a confusing failure, and this removes the whole class of it.

**Make reinstall work.** A user can reinstall an existing server, so the script
runs over a directory that already has files in it. `git clone` refuses a
non-empty directory. Use `git init` plus `git fetch` plus `git checkout -f`, which
works on both an empty directory and an existing checkout, and preserves anything
upstream gitignores (which is usually exactly the user's own config and plugins).

**Verify before you exit.** Import the packages you just installed, or run the
binary's `--version`. A dependency that silently failed to land shows up later as
a traceback in a console nobody is watching. Do the failing here, while the log is
still on screen.

**Comment the why, not the what.** `# --no-cache-dir` is worthless.
"HOME is the mounted volume, so the cache would count against the user's disk for
a cache nothing can read back" is what stops the next person from removing it.

The Modmail install script is a good template. Read it top to bottom before
writing a new one.

## The startup command

It is one long bash line, so build it in a file and keep that file next to your
test scripts. Modmail's, formatted for reading:

```bash
export PIP_USER=1
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PYTHONUNBUFFERED=1
export USING_DOCKER=yes
export PATH=/home/container/.local/bin:$PATH
for v in MODMAIL_GUILD_ID OWNERS LOG_URL; do [[ -z "${!v:-}" ]] && unset "$v"; done
if [[ "{{AUTO_UPDATE}}" == "1" ]] && [[ -d .git ]]; then
  echo "Checking for a Modmail update..."
  if git pull -q --ff-only --no-tags; then
    pip install -q -U -r requirements.txt
  else
    echo "Update skipped: local changes or a diverged branch. Booting the installed version."
  fi
fi
python bot.py
```

Things worth copying:

**Unbuffered output.** `PYTHONUNBUFFERED=1`, or the Node/Go equivalent. Without
it the console shows nothing for a while and then a wall of text, and the `done`
marker arrives late or not at all.

**Unset the empty variables.** Every optional variable arrives as an empty string.
Whether that is harmless depends entirely on the software, and for Modmail it is
fatal. The `for` loop with indirect expansion (`${!v}`) handles the whole list in
one line.

**Update on boot, and never let it block the boot.** If `git pull` fails because
the user edited a tracked file, say so and start the old version anyway. A server
that refuses to start because an optional update failed is worse than a slightly
stale one.

**Keep the update quiet.** `git pull` on a shallow checkout will happily print two
hundred lines of tag refs. `--no-tags -q` fixes it.

**Set the flag that makes runtime package installs work.** Modmail installs plugin
requirements at run time with a pip command that has no `--user`, which would try
to write to `/usr/local` and fail as uid 1000. `PIP_USER=1` in the environment
redirects it. Look for this pattern in anything with a plugin system.

## Variables

Naming: **use the exact environment variable name the software already reads.**
`TOKEN`, `GUILD_ID`, `CONNECTION_URI`. Do not invent `MODMAIL_TOKEN` and then map
it, because a mapping is one more thing to get wrong and it breaks the user's
ability to follow upstream documentation.

`rules` are Laravel validation rules, applied by the panel when the user saves.
The set we use:

- `required` or `nullable`
- `string`, `boolean`
- `max:N`, `alpha_dash`

`user_viewable: false` hides the variable from the user entirely. `user_editable:
false` shows it read-only. Use the latter for values that would break an existing
install if changed, like Red's instance name.

**Descriptions are the product.** They are the only documentation the user sees,
and they are read by someone who has not read the upstream docs. Say what the
value is, where to get it, and what happens if it is left empty. Compare:

> Bad: "The bot token."
>
> Good: "Your bot's token from the Discord Developer Portal (Bot -> Reset Token).
> Turn on the Server Members and Message Content intents on the same page, or the
> bot will not start."

Same for the failure modes you already know about: the MongoDB variable tells the
user to allow any IP in Atlas, because a server's outbound address can change and
the resulting timeout is unreadable.

## Testing with Podman

You do not need a panel. Podman reproduces both halves accurately enough to catch
essentially everything.

Work in a scratch directory with three files: `install.sh`, `startup.sh`, and the
volume directory the test will use.

### 1. The install container

```bash
mkdir -p server
podman run --rm \
  -v ./server:/mnt/server:z \
  -v ./install.sh:/install.sh:ro,z \
  -e MODMAIL_BRANCH=master \
  --entrypoint bash \
  python:3.11-slim-bookworm /install.sh
```

Every egg variable the script reads has to be passed with `-e`, exactly as the
panel would.

### 1b. The install container, on a volume you do not own

**Do the run above a second time against a directory owned by a different user.**
This is not optional and it is the step most likely to be skipped.

Rootless Podman maps your host user to root inside the container, so in the run
above root *is* the owner of the volume. On a real node it is not: the volume
belongs to the node's container user and the installer is root. Anything that
depends on that mismatch, which is git's ownership check and every file
permission the install leaves behind, is invisible until you reproduce it.

```bash
podman unshare rm -rf server && mkdir server
podman unshare chown -R 500:500 server
# then run the install exactly as in step 1
```

`podman unshare` runs the command inside the same user namespace the container
uses, which is the only way to set and inspect these ownerships from the host.
You will need it to delete the directory afterwards too.

Afterwards, check where the files landed:

```bash
podman unshare stat -c '%u:%g %n' server server/.git server/<some-installed-file>
```

Everything should read `500:500`. Anything reading `0:0` is a file the server
will not be able to write to.

We shipped the Modmail egg without this step and it failed on the first real
install, on the first git command.

### 2. The runtime container

```bash
podman run --rm \
  --userns=keep-id:uid=1000,gid=1000 \
  -v ./server:/home/container:z \
  -e STARTUP="$(cat startup.sh)" \
  -e AUTO_UPDATE=1 \
  -e TOKEN=not.a.real.token \
  -e GUILD_ID=1411277349684641924 \
  -e CONNECTION_URI="mongodb+srv://user:pass@cluster.example.mongodb.net/" \
  -e OWNERS= -e MODMAIL_GUILD_ID= -e LOG_URL= \
  ghcr.io/pelican-eggs/yolks:python_3.11
```

Note there is no `--entrypoint`. You want the yolk's real entrypoint, because
that is what does the `{{VAR}}` rewrite and the `eval`. Pass the startup string in
its panel form, with the braces, so you are testing the same string you commit.

**`--userns=keep-id:uid=1000,gid=1000` is required.** Rootless Podman maps your
host user to root inside the container by default, so files the installer created
end up owned by container-root while the runtime runs as uid 1000, and the bot
fails on its first `mkdir` with a permission error that has nothing to do with
your egg. `keep-id` lines the two up.

**Pass the optional variables as empty strings**, exactly as written above. That
is what the panel does, and it is the case most likely to be broken.

If you ran the foreign-ownership install from step 1b, boot that volume with
`--user 500:500` instead of `--userns=keep-id`, so the process runs as the user
that owns the files. That is the pairing a real node produces.

### What a passing test looks like

- Install exits 0 and the verify step prints what you expected.
- Reinstall over the same directory exits 0, and files the user would own
  (plugins, config) are still there afterwards.
- The runtime container boots, prints the software's own startup banner, and gets
  as far as whatever it cannot do without real credentials. For a Discord bot,
  reaching "Invalid token" with a deliberately fake token is a **pass**: it proves
  every dependency imported, the config loaded, and the network stack works.
- The console output is clean. No permission errors, no tracebacks, no fifty
  lines of package manager noise.

If you have real credentials and a throwaway Discord server, run it all the way
up and confirm the `done` marker string actually appears in the output. Otherwise
grep the source for it and check where it sits in the boot sequence.

### Cleaning up

`podman image prune`, and delete the scratch volume directories. They are large,
and a stale one will make your next test lie to you.

## Publishing

1. Put the file in `eggs/<name>.json`, lowercase, hyphenated.
2. Add an icon if there is a sensible source: add an entry to `src/icons.json`
   and run `bun run update-icons`, which fetches it and inlines it as a base64
   data URI. Skip it rather than inventing an unstable URL. `red-discordbot.json`
   and `modmail.json` have no icon for exactly that reason.
3. Commit with a message that explains the decisions, not the diff. The next
   person to touch the egg needs to know why the image is pinned, not that a JSON
   file was added.
4. Push to `main`.
5. **Import it into the panel.** This does not happen on its own. New eggs are
   imported by hand; existing eggs can be refreshed with the panel's update button,
   which pulls `meta.update_url`.

## Traps we have already hit

**Python minor version has to match across the two containers.** `pip install
--user` lands in `.local/lib/python3.11/site-packages`. If the install container
is 3.11 and the runtime yolk is 3.12, the bot boots into an empty site-packages
and fails on its first import. This is why application eggs pin exactly one
`docker_images` entry, and why adding a second one is not a free change.

**Native libraries live in the image, not the volume.** Modmail imports
`cairosvg` at startup and calls `sys.exit` if it fails, so `libcairo.so.2` is a
hard requirement of whatever image the egg runs on. The pelican Python yolks carry
cairo, pango and gdk-pixbuf. Check with:

```bash
podman run --rm --entrypoint bash <image> -c 'ldconfig -p | grep -i cairo'
```

**Root installs onto a volume it does not own.** Two separate failures come out of
this, and rootless Podman hides both unless you test for them deliberately. Git
refuses to run at all ("detected dubious ownership"), and every file the install
writes is left owned by root, which the server user cannot write to. Both fixes
are in the install script section above. Note that the git one interacts with
`HOME`: `git config --global` is the obvious fix and it is the wrong one in any
script that repoints `HOME` at the volume.

**Absolute paths recorded at install time.** Red's `redbot-setup` resolves and
saves its data path, which follows any symlink straight back to `/mnt/server`, a
directory that does not exist at run time. Read the config the installer wrote and
check it, do not assume.

**Empty variables are empty strings, not unset.** Covered above. It is the single
most common cause of "works locally, fails in the panel".

**The panel's `done` marker decides whether the server looks alive.** Pick a real
one.

**Log noise is a support cost, so remove the cause rather than the message.** A
red `ERROR` at the end of a successful install generates tickets whether or not
it means anything. Modmail's install used to end with a pip conflict, because the
Python image preinstalls `wheel`, `wheel` requires `packaging>=24`, and upstream's
lockfile pins `packaging==23.2`.

The tempting fixes are `--no-warn-conflicts` or a note in the output saying to
ignore it. Both are worse than finding out *which* package declares the
dependency:

```bash
podman run --rm --entrypoint bash <installer-image> -c 'pip show wheel | grep Requires'
```

`wheel` turned out to be the only thing in the image wanting `packaging` at all,
and nothing in the install needs it, since pip builds sdists in an isolated
environment with its own copy. Uninstalling it removes the conflict for real and
leaves the resolver free to report a genuine one.

**The install container runs as the image's user, not as root.** Wings sets no
user on the install container, so whatever the image's `USER` says is what the
script runs as. The pelican installer images are root, which is why every egg
here uses one; the *yolk* images are not, they drop to their own `container`
user. Using a yolk as an install image therefore looks reasonable and fails on a
real node, where the volume belongs to the node's user and not to the yolk's,
with a permission error on the first write. An install image has to be a root
image: one of `ghcr.io/pelican-eggs/installers:*`, or the software's own upstream
image, like `python:3.11-slim-bookworm` or `docker.io/oven/bun:1-debian`.

Note that this is only true of the install container. Wings *does* set the user
on the runtime container, which is why the yolk's own uid never matters there.

**And the installer images carry git, curl and unzip, nothing else.** No
language runtime, no compiler. Every runtime egg here used to end with a version
check, and three of them installed dependencies, all by running a binary that is
not in that image; `set -e` turned each one into an install that failed *after*
the clone had already worked, which is the least legible place for it. For a
runtime egg the dependency install belongs in the startup command anyway, where
it runs against the runtime that will load the result, which matters the moment
a dependency is native. Check before you write the line:

```bash
podman run --rm --entrypoint bash ghcr.io/pelican-eggs/installers:debian \
  -c 'command -v node npm python3 || echo "not in this image"'
```

**Native Node modules pin themselves to the interpreter and to the base image,
and the two containers have to agree.** `@discordjs/opus` loads its binary from a
directory whose name contains the ABI number the interpreter reports and the
glibc version of the image it was built in
(`prebuild/node-v147-napi-v3-linux-x64-glibc-2.41/`). Compile it on a different
Debian release, or under a different Bun, and the file is there but the runtime
computes another name and does not find it. So for an egg with native modules the
install image has to match the runtime image's base as well as its language
version, so the checklist item above is not only about the language.

That is not the same problem as two native modules disagreeing with each other.
`canvas` ships prebuilt and carries its own `libstdc++.so.6` next to the binary,
older than the one anything compiled during the install links against, and the
first module to load wins for the whole process. In the CorwinDev Discord-Bot egg
canvas loads first, so Opus then could not find `CXXABI_1.3.15` and the radio
handler died at every boot. Deleting the bundled copy in the install script fixes
it: canvas then resolves libstdc++ normally and finds the image's own, which is
new enough for both. The install script verifies the two in the order the
software loads them, because verifying them in the other order hides it.

Both of these survive a fix in the egg but not a rebuild of a rolling runtime
tag: `yolks:bun_latest` is the only Bun yolk published, so the day it is rebuilt
with a Bun that reports a different ABI, every server installed before it is
looking for a path that no longer matches. That is worth a line in the startup
command: load the native modules, and if they do not load, say so and name
Reinstall as the fix rather than leaving the user with a traceback.

## Checklist

- [ ] Fresh `uuid`, correct `meta.update_url`, filename matches
- [ ] `docker_images` lists only images the egg actually works on
- [ ] Install container's language version matches the runtime image
- [ ] Install image runs as root, and shares the runtime image's base if
      anything native is compiled during the install
- [ ] Install script has `set -euo pipefail`, is quiet, and verifies before exit
- [ ] Reinstall over an existing server works and keeps the user's files
- [ ] Git exception set through `GIT_CONFIG_*`, not `git config --global`
- [ ] Files left owned by the volume's user, not root
- [ ] No package cache or build junk left on the volume
- [ ] Startup line unsets empty optional variables
- [ ] Output is unbuffered
- [ ] Update-on-boot cannot prevent a boot
- [ ] `config.startup.done` matches a line the software prints only when ready
- [ ] `config.stop` matches how the software shuts down
- [ ] Every variable uses the software's own env var name
- [ ] Every description says where to get the value and what empty means
- [ ] Tested under Podman: fresh install, reinstall, boot, empty optionals
- [ ] Tested against a volume owned by a different uid (step 1b)
- [ ] Commit message explains the decisions

## Briefing Claude Code

Claude has Podman on the machine and can do this end to end. What you get back
depends almost entirely on how much of the above you put in the request.

A prompt that works:

> We want an egg for `<software>`, which is open source at `<repo URL>` and runs
> on `<language>`. Clone it into a temp directory and read it before you start.
> Check `Desktop/Hypefox/Velrix/Eggs` for our existing eggs, follow their
> conventions, and test with Podman locally.

Why that works: it names the repo, points at the conventions, and asks for a test.
Add anything you already know that is not obvious from the repo, for example
"we only want the stable branch" or "assume the user has no database".

**Things worth stating explicitly if you care about them:**

- Which runtime image or language version, if you have a preference
- Whether an external service (database, API key) is acceptable, or a blocker
- Whether update-on-boot should default on or off
- Anything the software needs that is not in its repo

**What to check before you approve it:**

- **Was it actually tested, or only written?** Ask for the Podman output. "It
  should work" is not a test. The install and the boot are two separate tests and
  both need to have happened.
- **Is the `done` marker real?** Ask which line it is and where in the source it
  is printed. This is the field most likely to be guessed.
- **Is more than one `docker_images` entry listed?** If so, ask how the install
  container's language version matches all of them. Usually it cannot.
- **Are the variable descriptions written for a user?** If they read like the
  upstream README's table, they are not finished.
- **Do the comments explain why?** An install script full of `# install
  dependencies` is a script nobody can safely change later.
- **Does reinstall work?** Ask directly. It is easy to skip and it breaks in
  production, not in testing.
- **Was it tested against a volume it does not own?** The default Podman recipe
  makes root the volume owner, which is not what a node does, and it hides both
  the git ownership check and every file-permission mistake. Ask for the
  `podman unshare chown` run specifically.

Claude will push to `main` when the change needs nothing from you, and will flag
what it cannot do itself. Importing a new egg into the panel is always yours.
