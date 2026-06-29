# archeo

Autonomously explores a running web application and produces a machine-readable JSON build spec — rebuild software you own or already pay for, without reverse-engineering by hand.

## Quickstart

```
archeo <url>
```

Point archeo at a live web application. It will ask for your authorization before launching a browser, then explore the app and produce a JSON build spec you can hand to an AI coding agent.

`npm install` runs `playwright install chromium` automatically via the postinstall script.

**Node engine:** Node 24+ runs TypeScript natively with no flags. Node 22–23 contributors prepend `NODE_OPTIONS=--experimental-strip-types` to dev commands.
