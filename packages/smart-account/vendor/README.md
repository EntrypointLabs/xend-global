# Vendored Squads SDK

`@sqds/smart-account` is not published to npm. It lives at `sdk/smart-account` inside
the program repo, and npm cannot install a package from a subdirectory of a git
repository, so it is built from a pinned commit and committed here as a tarball.

|             |                                                                    |
| ----------- | ------------------------------------------------------------------ |
| Source      | https://github.com/Squads-Protocol/smart-account-program           |
| Commit      | `80bf1f7ad28fd1176c364879776982730b8e9c80`                         |
| SDK version | 2.1.2                                                              |
| SDK license | MIT (the program itself is AGPL-3.0, which does not reach callers) |
| Program     | `SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG`, mainnet and devnet  |

## Refreshing the pin

```sh
git clone https://github.com/Squads-Protocol/smart-account-program.git
cd smart-account-program && git checkout <new-sha>
cd sdk/smart-account && npm install
npx tsup src/index.ts --format esm,cjs --outDir lib
npx tsc --emitDeclarationOnly
npm pack --pack-destination /tmp
```

Copy the tarball here, update the commit and version above, update the `file:`
dependency in `package.json`, delete the old tarball, and run the tests. They execute
against real deployed bytecode, so a genuine behaviour change will surface.
