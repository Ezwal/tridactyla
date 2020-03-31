#!/usr/bin/env node
'use strict';

const { once } = require('events');
const fs = require('fs');
const process = require('process');

const axios = require('axios');

if (process.argv.length < 3) {
    console.error('missing collection id');
    process.exit(1);
}

const collectionId = process.argv[2];
const is4k = process.argv[3] === '4k';

const getCollectionUrl = id => page => `https://www.artstation.com/collections/${id}/projects.json?collection_id=${id}&page=${page}`;
const fetchJsonPage = async url => (await axios.get(url)).data;

const sanitizeForFs = s => s.replace(/[\\\/?"!<>:|?*]/gi, ''); // for both windows and linux...
const getLargeArtwork = s => s
      .replace('/small_square/', is4k ? '/4k/' : '/large/')
      .replace(/\d{14}\//, '');
const pickArtworkData = pageArtwork => pageArtwork.data.map(singleArtwork => ({
    title: `${sanitizeForFs(singleArtwork.title)} - ${sanitizeForFs(singleArtwork.user.username)}`,
    link: getLargeArtwork(singleArtwork.cover.small_square_url),
    assets_count: singleArtwork.assets_count,
}));

const downloadDir = './artworks'
const drainWriter = writable => {
    if (writable.destroyed) {
        return Promise.reject(new Error('premature close'));
    }
    return Promise.race([
        once(writable, 'drain'),
        once(writable, 'close')
            .then(() => Promise.reject(new Error('premature close')))
    ]);
}

const downloadArtwork = async (title, link) => {
    const res = await axios({
        url: link,
        method: 'get',
        responseType: 'stream',
    });
    const fileWriter = res.data.pipe(fs.createWriteStream(`${downloadDir}/${title}.jpg`));
    await drainWriter(fileWriter);
}
const downloadAll = async artworksInfo => {
    await fs.promises.mkdir(downloadDir, { recursive: true });
    artworksInfo.reduce(async (prevDownload, {title, link}) => {
        await prevDownload;
        console.log(`[log] ${title} from ${link}`);

        let tryCount = 3;
        let artworkDrain;
        while (tryCount > 0) {
            try {
                artworkDrain = await downloadArtwork(title, link);
                break;
            } catch (err) {
                console.error(`[err] ${title} downloading failure, tryCount ${tryCount}`)
                tryCount -= 1;
            }
        }
    }, Promise.resolve());
}

const getFirstArtwork = async (url, is4k = false) => {
    const getCollectionPage = getCollectionUrl(url);
    console.log('collection url ', getCollectionPage(1), 'usw...');

    try {
        const firstPage = await fetchJsonPage(getCollectionPage(1));
        let allArtworks = pickArtworkData(firstPage);

        let pageCount = 2;
        while (allArtworks.length !== firstPage.total_count) {
            const pageArtwork = await fetchJsonPage(getCollectionPage(pageCount));
            const filteredArtworkInfo = pickArtworkData(pageArtwork);

            allArtworks = allArtworks.concat(filteredArtworkInfo);
            pageCount += 1;
        }

        console.log('artworks nb :', allArtworks.length, 'page nb :', pageCount);
        await downloadAll(allArtworks)
    } catch (err) {
        console.error(err);
    }
}

(async () =>{
    await getFirstArtwork(collectionId);
})()
