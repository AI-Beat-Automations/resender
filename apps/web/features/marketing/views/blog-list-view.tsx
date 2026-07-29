import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { HtmlLang } from "@/components/html-lang"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { BlogList, type BlogListItem } from "@/features/marketing/ui/blog-list"
import { JsonLd } from "@/components/json-ld"
import { getPublishedPosts, formatDate } from "@/lib/blog"
import { baseGraph, breadcrumbSchema, schemaGraph } from "@/lib/schema"
import { SITE_NAME } from "@/lib/site-config"
import { getDictionary, type Locale } from "@/content/i18n"

// Listado del blog compartido por `/blog` (ES) y `/en/blog` (EN). Los posts se
// leen de content/blog/<lang>/.
export function BlogListView({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang)

  const posts: BlogListItem[] = getPublishedPosts(lang).map((post) => ({
    slug: post.slug,
    title: post.title,
    abstract: post.abstract,
    category: post.category,
    publishedOn: post.publishedOn,
    dateLabel: post.publishedOn ? formatDate(post.publishedOn, lang) : "",
  }))

  return (
    <div className="light flex min-h-svh flex-col">
      <JsonLd
        data={schemaGraph(
          ...baseGraph(lang),
          breadcrumbSchema(
            [
              { name: SITE_NAME, path: "/" },
              { name: dict.blog.title, path: "/blog" },
            ],
            lang
          )
        )}
      />
      <HtmlLang lang={lang} />
      <SiteBackground />
      <SiteHeader lang={lang} />
      <main className="flex-1">
        <Section>
          <SectionHeading as="h1" title={dict.blog.title} />
          <p className="mx-auto mt-6 max-w-2xl text-center leading-8 text-muted-foreground">
            {dict.blog.intro}
          </p>

          {posts.length === 0 ? (
            <p className="mt-12 text-center text-muted-foreground">
              {dict.blog.empty}
            </p>
          ) : (
            <BlogList lang={lang} posts={posts} />
          )}
        </Section>
      </main>
      <SiteFooter lang={lang} />
    </div>
  )
}
