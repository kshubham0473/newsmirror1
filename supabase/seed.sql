-- Seed: starter sources for NewsMirror
-- Paste into Supabase SQL editor after running schema.sql
-- Replace any dead RSS URLs with working ones from your research

insert into sources (name, rss_url, home_url, language) values
  -- Centrist / establishment English
  ('The Hindu',         'https://www.thehindu.com/news/national/?service=rss', 'https://thehindu.com',        'en'),
  ('Indian Express',    'https://indianexpress.com/feed/',                      'https://indianexpress.com',   'en'),

  -- Independent / liberal
  ('The Wire',          'https://thewire.in/rss',                               'https://thewire.in',          'en'),
  ('Scroll',            'https://scroll.in/rss',                                'https://scroll.in',           'en'),
  ('The Quint',         'https://www.thequint.com/rss',                         'https://thequint.com',        'en'),

  -- Nationalist / right-leaning
  ('Opindia',           'https://www.opindia.com/feed/',                        'https://opindia.com',         'en'),
  ('First Post',        'https://www.firstpost.com/rss',                        'https://firstpost.com',       'en'),

  -- Market / business
  ('Mint',              'https://www.livemint.com/rss/news',                    'https://livemint.com',        'en'),

  -- Broadcast / mainstream
  ('NDTV',              'https://feeds.feedburner.com/ndtvnews-top-stories',    'https://ndtv.com',            'en'),
  ('The Print',         'https://theprint.in/feed/',                            'https://theprint.in',         'en');
