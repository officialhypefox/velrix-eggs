# Velrix Eggs

Pelican eggs for the Velrix panel, with automated icon management.

Each file in `eggs/` describes how one piece of software is installed and run.
Adding or changing one? Read **[docs/writing-eggs.md](docs/writing-eggs.md)**
first. It covers how eggs work, how to read an upstream project well enough to
package it, how to test locally with Podman, and how to brief Claude Code.

## Usage

To install dependencies:

```bash
bun install
```

To update icons:

```bash
bun run update-icons
```

## Icons

Icons are sourced from [skill-icons](https://github.com/tandpfun/skill-icons) (MIT License).
