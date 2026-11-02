/** Optional pure encoders owned by security. Choose the destination explicitly;
 * translations never grant permission for HTML, URL, JavaScript or CSS execution.
 */
export { escapeHtmlText, escapeHtmlAttribute, serializeJsonForScript, validateNavigationUrl } from "@zeruxjs/security/encoding";
