# Third-party notices

## OmniRoute web tool-call translators

The following files are mechanically transpiled from OmniRoute commit
`85b9c1754e4191f36d0058829ff7b4db213359e7`:

- `adapter/src/omniroute-web-tools.js` from `open-sse/translator/webTools.ts`
- `adapter/src/omniroute-deepseek-web-tools.js` from
  `open-sse/translator/deepseekWebTools.ts`

TETHER calls these translators directly. It does not reuse OmniRoute's
full-trajectory prompt projection because TETHER relies on the persistent
browser conversation for semantic history.

OmniRoute is distributed under the following license:

> MIT License
>
> Copyright (c) 2026 diegosouzapw
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
