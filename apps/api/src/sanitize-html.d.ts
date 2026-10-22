declare module "sanitize-html" {
  type HtmlAttributes = Record<string, string>
  type TransformTag = (
    tagName: string,
    attributes: HtmlAttributes,
  ) => { tagName: string; attribs: HtmlAttributes }

  type SanitizeOptions = {
    allowedTags?: string[]
    allowedAttributes?: Record<string, string[]>
    allowedSchemes?: string[]
    transformTags?: Record<string, TransformTag>
  }

  const sanitizeHtml: (dirty: string, options?: SanitizeOptions) => string
  export default sanitizeHtml
}
