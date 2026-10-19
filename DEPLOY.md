# Deploy MapCheck

MapCheck is a Next.js 16 app (`next` 16.4.2 in `package.json`). Deploy it with the Vercel CLI to team `amys-projects-d3dfb125`, project name `mapcheck`.

There is no GitHub-push workflow for this deploy. Do not connect a Git repository. Run the commands below from this directory when you are ready. This pass does not log in and does not deploy.

No application env vars are required. The page audits an ActionMap or a log you import. It does not call an API. The synthetic sample stays unloaded until someone asks for it.

`vercel.json` sets `framework` to `nextjs` and `buildCommand` to `npm run build`. `outputDirectory` is omitted on purpose. This app is not a static export (`output: "export"` is not set in `next.config.ts`). The Next.js preset publishes the server build in `.next`. Setting `outputDirectory` would fight that preset.

Node.js 22 or newer.

## Commands

Install and confirm the production build locally:

```bash
npm install
npm run build
```

Link the directory to the team project, then deploy production. These flags match Vercel CLI 64 (`--team` with `--project` is the non-interactive link). Authentication is required at this step. Either export `VERCEL_TOKEN` first, or complete `npx vercel login` in this terminal. There is no token in the repo.

```bash
npx vercel link --yes --team amys-projects-d3dfb125 --project mapcheck
npx vercel deploy --prod
```

With `VERCEL_TOKEN` set in the environment, those two commands skip the browser login. You can also pass `--token "$VERCEL_TOKEN"` on each command. Without a token, the CLI asks you to log in before `link` or `deploy` can finish.
