/**
 * dsh-quote-dispatch — host 半边。
 *
 * 本插件是**纯客户端插件**：host 侧不需要任何行为。
 * 这个空的 apply 存在的唯一作用，是让 client-modules 扫描到一个「已启用的
 * Loader entry」；浏览器半边通过 package.json 的 `exports["./client"]` +
 * `dsh.client` 声明被发现。
 */
/** Host plugin body — no host-side behavior. */
function apply() {}

export { apply }
