import type { MDXComponents } from "mdx/types"

// Required by @next/mdx with the App Router. Global MDX component overrides
// would go here; blog posts are styled by the `prose` wrapper in
// features/marketing/views/blog-post-view.tsx.
const components: MDXComponents = {}

export function useMDXComponents(): MDXComponents {
  return components
}
