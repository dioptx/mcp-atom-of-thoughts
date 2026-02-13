# TODO — Before Public Launch

GitHub repo is live but npm publish is **on hold** until branding and presence are established.

## Pre-Launch Checklist

### 1. Online Presence
- [ ] **X (Twitter) account** — establish `@dioptx` or project-specific handle, build following
- [ ] **LinkedIn profile** — developer brand, posts about MCP/AI tooling
- [ ] Consistent branding across both platforms (bio, avatar, links)

### 2. Project Website
- [ ] Self-hosted landing page for atom-of-thoughts
- [ ] Interactive demo or embedded D3 visualization
- [ ] Clear install instructions, use cases, architecture diagram
- [ ] Link to GitHub repo + npm (once published)

### 3. npm Publish
- [ ] `npm login` (requires OTP)
- [ ] `npm publish --access public`
- [ ] Verify: `npx -y @dioptx/mcp-atom-of-thoughts` starts cleanly
- [ ] Update README badges once npm version resolves

### 4. Smithery Publish (Optional)
- [ ] `npx -y @smithery/cli publish`

### 5. Announcement
- [ ] X post (template in plan file)
- [ ] LinkedIn post (template in plan file)
- [ ] Submit to MCP server directories / awesome-mcp lists

## Current State (2026-02-13)

- GitHub: `github.com/dioptx/mcp-atom-of-thoughts` — PUBLIC, v2.0.0 release
- npm: NOT published yet
- Tests: 121 passing
- CI: GitHub Actions on push/PR (Node 18, 20, 22)
- Local MCP: pointing to `~/projects/mcp-atom-of-thoughts/build/index.js`
