---
title: Specification
description: Where to find the normative Patter language + format specification.
---

The normative specification (the language, the flow model, the bundle format, and the
runtime semantics every Patterplay port must implement) is defined in this repository by
the format documentation and an executable contract:

- [**Format & language docs**](/format/overview/): the structure, choices and logic,
 game data and addressing, and the on-disk bundle format.
- [**`packages/conformance`**](https://github.com/patterkit/patter/tree/main/packages/conformance):
 the executable parity contract (`corpus.json`) and its reference runners, the precise,
 testable definition a native port is held to.

A native-port author works from the format docs, then proves the port by passing the
corpus (see [Compatibility](/compatibility/)).

:::note
Documentation here is unversioned for now - it tracks the latest release. Versioned docs
may follow once the schema and runtimes stabilise.
:::
