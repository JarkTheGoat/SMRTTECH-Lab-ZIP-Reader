(() => {
    'use strict';

    function shouldOpenInNewTab(link) {
        const href = (link.getAttribute('href') || '').trim().toLowerCase();
        return href &&
            !href.startsWith('#') &&
            !href.startsWith('javascript:') &&
            !href.startsWith('mailto:') &&
            !href.startsWith('tel:') &&
            !link.hasAttribute('download') &&
            link.dataset.sameTab === undefined;
    }

    function configureLink(link) {
        if (!(link instanceof HTMLAnchorElement) || !shouldOpenInNewTab(link)) return;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    }

    function configureLinks(root = document) {
        root.querySelectorAll?.('a[href]').forEach(configureLink);
    }

    function setupNewTabLinks() {
        configureLinks();

        document.addEventListener('click', event => {
            configureLink(event.target.closest?.('a[href]'));
        }, true);

        new MutationObserver(records => {
            records.forEach(record => record.addedNodes.forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                if (node.matches?.('a[href]')) configureLink(node);
                configureLinks(node);
            }));
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupNewTabLinks, { once: true });
    } else {
        setupNewTabLinks();
    }
})();
