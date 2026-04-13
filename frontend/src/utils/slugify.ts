export function slugify(text: string, existingIds: string[] = []): string {
  // Replace accented characters
  let slug = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Replace whitespaces with _, remove special, to lowercase
  slug = slug
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '');

  if (!slug) {
    slug = 'trip';
  }

  let finalSlug = slug;
  let counter = 1;
  while (existingIds.includes(finalSlug)) {
    finalSlug = `${slug}_${counter}`;
    counter++;
  }

  return finalSlug;
}
