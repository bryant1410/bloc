# `bloc` v2.0 roadmap

## Introduction

`bloc` is becoming a major, if not the most central, part of the `strato` product, at the least from the user's point of view. Unfortunately it is not as stable as the rest of our product. This is due to a number of factors:

+ Changing scope, it is an evolving product
+ Often the place for "quick solutions" during deadlines
+ Dynamically typed JavaScript - we have no compile-time checks

## Suggested improvements

### Low effort:

+ Update the `tests` to run on commit
+ Unify `/templates` and `/app` so that we can test against `bloc` as well as after `bloc init`. This will give every `bloc` user a test-suite to test against their `strato` instance as well.
+ Include e2e tests in the test-suite
+ Use a stricter `eslint` profile
+ Dockerize and use `nodemon` by default so that we get a tight compile-test loop (see `cirrus`)
+ Version the API and make sure it matches `strato-api` and `cirrus`

### Medium effort:

+ Refactor the routes to only use the newer `*list` functions. Write specialized routes replacing the old routes to cover the API spec. (TODO @kejace: write a detailed proposal on what to do here).
+ Replace disk-backend with a proper DB. This requires(?) the dockerization too (see `cirrus`)
+ Convert to `TypeScript` or enforce `@flow` type annotations. 

### Large effort:

+ Rewrite `bloc` in haskell / ghcjs / purescript. This could but doesn't have to coincide with rewriting `strato-api` using `servant`.

## Interop 

`bloc` is currently depending on multiple pieces of `strato` and it should reliably handshake with these products to ensure interoperability.

### `strato`

Problem: `bloc` makes assumptions on `strato` that it cannot verify

Solution:
+ On startup, talk to `strato` only start after this has been verified:
 + Version
 + Mining profile
 + Network info

### `cirrus`

We effectively want to hook in calls to `cirrus` on (every?) route. This is possibly a pattern that we want to generalize (think logging, perhaps auth, etc.)

+ `cirrus` should be enabled with a flag
+ `bloc` should handshake with `cirrus` (regularly) and notify the user if it is down

## Future architecture

We should also consider the above proposed work in the light of future features that we want to see `bloc` have:

+ auth
+ automatic `REST API` generation for Solidity files: `OPTIONS` should essentially resolve to `xabi` for any contract.
+ throttling / capping
+ multichain support
+ LDAP integration