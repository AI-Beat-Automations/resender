import type { MDXComponents } from "mdx/types"

// Required by @next/mdx with the App Router. Global MDX component overrides
// would go here; styling is handled by the `prose` wrapper in app/docs/layout.tsx.
const components: MDXComponents = {}

export function useMDXComponents(): MDXComponents {
  return components
}
