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

const getCollectionUrl = id => page => `https://www.artstation.com/collections/${id}/projects.json?collection_id=${id}&page=${page}`;
const fetchJsonPage = async url => (await axios.get(url)).data;

const sanitizeForFs = s => s.replace(/[\\\/?"!<>:|?*]/gi, ''); // for both windows and linux...
const getLargeArtwork = s => s
      .replace('/small_square/', '/large/')
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
const downloadAll = async artworksInfo => {
    await fs.promises.mkdir(downloadDir, { recursive: true });
    artworksInfo.forEach(async ({title, link}) => {
        const res = await axios.get(link, {responseType: 'stream'});
        const fileWriter = res.data.pipe(fs.createWriteStream(`${downloadDir}/${title}.jpg`))

        await drainWriter(fileWriter);
    })
}

const getFirstArtwork = async url => {
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