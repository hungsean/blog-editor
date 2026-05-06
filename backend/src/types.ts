export type Draft = {
  id: string;
  title: string;
  lang: string;
  slug: string;
  description: string;
  tags: string;
  fields: string;
  content: string;
  status: string;
  pr_url: string;
  github_path: string;
  github_sha: string;
  created_at: string;
  updated_at: string;
};

export type TranslationPreset = {
  id: string;
  keywords: string;
  translations: string;
  note: string;
  created_at: string;
  updated_at: string;
};
