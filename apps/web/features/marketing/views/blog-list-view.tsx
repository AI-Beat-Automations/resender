import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { HtmlLang } from "@/components/html-lang"
import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { BlogList, type BlogListItem } from "@/features/marketing/ui/blog-list"
import { getPublishedPosts, formatDate } from "@/lib/blog"
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
    <div className="flex min-h-svh flex-col">
      <HtmlLang lang={lang} />
      <SiteBackground />
      <SiteHeader lang={lang} />
      <main className="flex-1">
        <Section>
          <SectionHeading title={dict.blog.title} subtitle={dict.blog.subtitle} />

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
