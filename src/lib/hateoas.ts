import { Request } from 'express';

/**
 * HATEOAS link interface
 */
export interface Link {
  rel: string;
  href: string;
  method?: string;
  type?: string;
}

/**
 * HATEOAS resource interface
 */
export interface HATEOASResource {
  _links?: Link[];
  _embedded?: Record<string, unknown>;
}

/**
 * Generate base URL from request
 */
export const getBaseUrl = (req: Request): string => {
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
};

/**
 * Generate API base URL
 */
export const getApiBaseUrl = (req: Request, version?: string): string => {
  const baseUrl = getBaseUrl(req);
  return version ? `${baseUrl}/api/${version}` : `${baseUrl}/api`;
};

/**
 * Create HATEOAS link
 */
export const createLink = (
  rel: string,
  href: string,
  method: string = 'GET',
  type: string = 'application/json'
): Link => {
  return { rel, href, method, type };
};

/**
 * Generate pagination links
 */
export const generatePaginationLinks = (
  req: Request,
  page: number,
  totalPages: number,
  basePath: string
): Link[] => {
  const baseUrl = getBaseUrl(req);
  const query = new URLSearchParams(req.query as Record<string, string>);
  const links: Link[] = [];

  // Self link
  query.set('page', page.toString());
  links.push(
    createLink('self', `${baseUrl}${basePath}?${query.toString()}`, 'GET')
  );

  // First page
  if (page > 1) {
    query.set('page', '1');
    links.push(
      createLink('first', `${baseUrl}${basePath}?${query.toString()}`, 'GET')
    );
  }

  // Previous page
  if (page > 1) {
    query.set('page', (page - 1).toString());
    links.push(
      createLink('prev', `${baseUrl}${basePath}?${query.toString()}`, 'GET')
    );
  }

  // Next page
  if (page < totalPages) {
    query.set('page', (page + 1).toString());
    links.push(
      createLink('next', `${baseUrl}${basePath}?${query.toString()}`, 'GET')
    );
  }

  // Last page
  if (page < totalPages) {
    query.set('page', totalPages.toString());
    links.push(
      createLink('last', `${baseUrl}${basePath}?${query.toString()}`, 'GET')
    );
  }

  return links;
};

/**
 * Generate resource links
 */
export const generateResourceLinks = (
  req: Request,
  resourceId: string,
  resourcePath: string,
  availableActions: string[] = []
): Link[] => {
  const baseUrl = getBaseUrl(req);
  const links: Link[] = [];

  // Self link
  links.push(
    createLink('self', `${baseUrl}${resourcePath}/${resourceId}`, 'GET')
  );

  // Collection link
  links.push(createLink('collection', `${baseUrl}${resourcePath}`, 'GET'));

  // Action links
  if (availableActions.includes('update')) {
    links.push(
      createLink(
        'update',
        `${baseUrl}${resourcePath}/${resourceId}`,
        'PUT',
        'application/json'
      )
    );
  }

  if (availableActions.includes('delete')) {
    links.push(
      createLink('delete', `${baseUrl}${resourcePath}/${resourceId}`, 'DELETE')
    );
  }

  if (availableActions.includes('patch')) {
    links.push(
      createLink(
        'patch',
        `${baseUrl}${resourcePath}/${resourceId}`,
        'PATCH',
        'application/json'
      )
    );
  }

  return links;
};

/**
 * Add HATEOAS links to resource
 */
export const addHATEOASLinks = <T extends Record<string, unknown>>(
  resource: T,
  links: Link[]
): T & HATEOASResource => {
  return {
    ...resource,
    _links: links,
  };
};

/**
 * Add embedded resources (for collections)
 */
export const addEmbeddedResources = <T extends Record<string, unknown>>(
  resource: T,
  embedded: Record<string, unknown>
): T & HATEOASResource => {
  return {
    ...resource,
    _embedded: embedded,
  };
};
