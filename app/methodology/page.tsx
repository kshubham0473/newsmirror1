import Link from 'next/link';
import ScrollableLayout from '@/components/ui/ScrollableLayout';
import styles from './Methodology.module.css';

export const metadata = {
  title: 'Methodology — NewsMirror',
};

export default function MethodologyPage() {
  return (
    <ScrollableLayout>
      <main className={styles.page}>
        <header className={styles.hero}>
          <h1 className={styles.title}>How we classify coverage</h1>
          <p className={styles.lead}>
            NewsMirror uses AI to describe how outlets tend to frame political stories in India — not to judge
            readers, but to surface blind spots.
          </p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>1. Why we classify at all</h2>
          <p className={styles.body}>
            Indian newsrooms make real editorial choices every day &mdash; which stories to run, which voices to quote,
            what gets framed as normal and what feels exceptional. Our goal is to make those patterns visible in a
            gentle way, so readers can notice where they might only be hearing one kind of framing.
          </p>
          <p className={styles.body}>
            The point is not to tell you what to read or to label any outlet as good or bad. The point is to help you
            see &ldquo;this is how this set of outlets usually frames things&rdquo; and then decide for yourself whether you want
            to balance that with other perspectives.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>2. Why we don&apos;t use left / right labels</h2>
          <p className={styles.body}>
            Indian politics does not map neatly onto a single left&ndash;right spectrum. Hindutva politics, secular
            nationalism, Ambedkarite movements, regional parties and Marxist left traditions can all clash or align in
            different ways that a simple Western left / right slider cannot capture.
          </p>
          <p className={styles.body}>
            Instead of forcing outlets into &ldquo;left&rdquo; or &ldquo;right&rdquo; boxes, we look at four separate axes of editorial
            framing that show how a source tends to talk about identity, the state, the economy and institutions over
            time.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>3. The four axes we track</h2>
          <div className={styles.axisGrid}>
            <div className={styles.axisBlock}>
              <h3 className={styles.axisHeading}>Group framing</h3>
              <p className={styles.axisEnds}>Plural &amp; equal &rarr; Majority-centric</p>
              <p className={styles.bodySmall}>
                Looks at whether coverage tends to treat different communities as equal participants, or whether the
                majority community is treated as the default and others appear as &ldquo;them&rdquo; or as side characters.
              </p>
            </div>
            <div className={styles.axisBlock}>
              <h3 className={styles.axisHeading}>Government coverage</h3>
              <p className={styles.axisEnds}>Sceptical &amp; questioning &rarr; Accepting &amp; deferential</p>
              <p className={styles.bodySmall}>
                Checks whether government claims are routinely tested against independent evidence and opposition views,
                or mostly carried as-is with little challenge.
              </p>
            </div>
            <div className={styles.axisBlock}>
              <h3 className={styles.axisHeading}>Economic lens</h3>
              <p className={styles.axisEnds}>Welfare &amp; people &rarr; Markets &amp; growth</p>
              <p className={styles.bodySmall}>
                Sees whether economic stories foreground the impact on workers, welfare and inequality, or whether the
                main focus is on GDP, investors, markets and ease of doing business.
              </p>
            </div>
            <div className={styles.axisBlock}>
              <h3 className={styles.axisHeading}>Institutions</h3>
              <p className={styles.axisEnds}>Critical &amp; questioning &rarr; Deferential &amp; trusting</p>
              <p className={styles.bodySmall}>
                Looks at how courts, the RBI, the Election Commission and other institutions are written about &mdash;
                with active scrutiny and debate, or with strong deference and praise and little space for criticism.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>4. How the scores are calculated</h2>
          <p className={styles.body}>
            For each article that passes our Stage 1 content filter, we send the headline, summary and a slice of the
            full text to Gemini, with a detailed prompt describing the four axes above. Gemini returns soft scores
            between 0.0 and 1.0 on each axis, along with a short rationale.
          </p>
          <p className={styles.body}>
            We never publish a source profile until at least 10 articles from that outlet have been classified in the
            last 90 days. The source profile you see on the{' '}
            <code className={styles.inlineCode}>/sources</code> page is a rolling 90-day average of
            those per-article scores, updated regularly as new coverage comes in.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>5. What these scores do <span className={styles.emphasis}>not</span> mean</h2>
          <ul className={styles.list}>
            <li>They are not a quality ranking or a measure of &ldquo;good&rdquo; versus &ldquo;bad&rdquo; journalism.</li>
            <li>They are not a trust or fact&ndash;checking score and should not be read as such.</li>
            <li>They do not tell you what to read or which outlets you should avoid.</li>
          </ul>
          <p className={styles.body}>
            The scores are a way to visualise habitual framing, not a verdict on any single story or newsroom. Many good
            outlets will still cluster on one side of an axis because of the audiences they serve and the choices they
            intentionally make.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>6. Limitations and caveats</h2>
          <p className={styles.body}>
            AI models can misread tone, sarcasm or missing context. Different beats and individual reporters within the
            same outlet will also frame issues differently. Our scores smooth over that variation into an average.
          </p>
          <p className={styles.body}>
            Because we use a 90-day window and require a minimum number of articles, scores react slowly when an
            outlet&apos;s editorial stance genuinely changes. Treat the profiles as a snapshot of recent patterns, not a
            permanent label.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>7. If you disagree with a profile</h2>
          <p className={styles.body}>
            If you are a reader or part of a newsroom and believe a source profile misrepresents your outlet, we would
            genuinely like to hear from you. The most useful feedback includes concrete links to recent articles where
            you feel the framing has been read incorrectly.
          </p>
          <p className={styles.body}>
            Please email us with those links and any context you want to add. We review such feedback periodically and
            may adjust prompts or guardrails where we find systematic issues, while still keeping the system independent
            of any single actor.
          </p>
        </section>

        <footer className={styles.footer}>
          <p className={styles.footerText}>
            Methodology last updated March 2026. As we learn more about how Indian outlets and readers use this layer,
            we will refine both the axes and the explanations here.
          </p>
        </footer>
      </main>
    </ScrollableLayout>
  );
}
