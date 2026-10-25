# Breakwater

An autonomous demurrage desk for Meridian Commodities. Breakwater investigates voyage evidence, calculates payable and recoverable demurrage, asks the responsible person for decisions, files claims, posts balanced journals and learns governed procedures from human work.

Next.js provides the desk and voyage room. Convex owns work, data and audit history. Claude proposes tool actions and lessons; Jev classifies lessons through `@langchain/typesafe`. Deterministic code controls money, permissions, memory activation and postings.

Read [the specification](docs_v2/README.md), [local setup and demo flow](workflow.md) and [source status](progress.md).

Node 22.13+ and a separate local Convex deployment are required. Set Claude and Jev keys only in Convex. Jev supports direct TypeSafe or OpenRouter transport; see [LEARNING](docs_v2/LEARNING.md). No credentials, installed dependencies, prepared database or backend state are included.

This source snapshot has not been run or tested. Test sources describe intended checks; they do not establish current accuracy or a successful demo. GitHub checks are manual.

Repository: https://github.com/Parth-Dua/breakwater-submission
