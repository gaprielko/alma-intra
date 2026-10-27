import { createFileRoute } from '@tanstack/react-router';
import { CampaignList } from '@/components/emails/campaign-list';

export const Route = createFileRoute('/_app/emails/drafts')({
  component: () => (
    <main className="max-w-[1440px] px-7 pt-5 pb-10">
      <CampaignList status="draft" />
    </main>
  ),
});
