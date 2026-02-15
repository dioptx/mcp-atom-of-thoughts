# Contributing

Thanks for your interest in contributing to mcp-atom-of-thoughts!

## Reporting Bugs

Open a [bug report](https://github.com/dioptx/mcp-atom-of-thoughts/issues/new?template=bug_report.md) with:

- Steps to reproduce
- Expected vs actual behavior
- Node version and OS

## Suggesting Features

Open a [feature request](https://github.com/dioptx/mcp-atom-of-thoughts/issues/new?template=feature_request.md) describing the problem you want to solve.

## Development Setup

```bash
git clone https://github.com/dioptx/mcp-atom-of-thoughts.git
cd mcp-atom-of-thoughts
npm install
npm run build
npm test
```

Requirements: Node.js >= 18

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests for any new behavior
4. Run the full test suite: `npm test`
5. Run the build to check for type errors: `npm run build`
6. Open a pull request

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Ensure `npm test` passes before submitting
- Update documentation if you change user-facing behavior

## Code Style

- TypeScript with strict mode enabled
- Tests use [vitest](https://vitest.dev/)
- Follow existing patterns in the codebase

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
