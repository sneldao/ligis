# Contributing to Ligis

Thanks for your interest in contributing! This is a hackathon and research
project, so small focused PRs are best.

## Getting Started

1. Clone the repo: `git clone https://github.com/sneldao/ligis.git`
2. Install dependencies: `pnpm install`
3. Build contracts and packages: `pnpm build`
4. Run tests: `pnpm test` (Foundry) and `pnpm test:ts`

## Pull Request Process

1. Fork the repository and create a branch: `git checkout -b feature/your-feature`
2. Make your changes and add tests where applicable
3. Ensure the full workspace builds: `pnpm build`
4. Ensure tests pass: `pnpm test:all`
5. Open a PR with a clear description of the change and why it is needed

## Code Style

- TypeScript: the repo uses Prettier; run `pnpm format` before committing
- Solidity: run `forge fmt` via `bash scripts/forge.sh fmt`
- Rust/Odra: run `cargo fmt` in `packages/contracts-casper/`

## Reporting Issues

Please use the issue templates when reporting bugs or requesting features.
Include steps to reproduce, expected behavior, and environment details.

## Security Issues

See [SECURITY.md](../SECURITY.md) for how to report security vulnerabilities.
