/**
 * @title VNode Types
 * @description Defines the virtual DOM node structure for ZyroJS.
 */

export type VNodeChild = VNode | string | number | boolean | null | undefined | (() => any);

export interface VNode {
    type: string | Function;
    props: Record<string, any>;
    children: VNodeChild[];
    el?: Node;
}

/**
 * @description Hyperscript function to create VNodes.
 * @param {string | Function} type - Element tag or Component function.
 * @param {Record<string, any>} props - Element attributes/props.
 * @param {VNodeChild[]} children - Children nodes.
 * @returns {VNode}
 */
export function h(type: string | Function, props: Record<string, any> | null, ...children: VNodeChild[]): VNode {
    return {
        type,
        props: props || {},
        children: children.flat().filter(child => child !== null && child !== undefined && child !== false),
    };
}
