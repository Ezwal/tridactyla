#!/usr/bin/env node
'use strict';

const { once } = require('events');
const fs = require('fs');
const process = require('process');

const axios = require('axios');

if (process.argv.length < 3) {
    console.log(`Usage: node index.js COLLECTION_ID [4k] [diff]
   4k - try to download the artwork in 4k if possible
   diff - if artwork already exists then dont dl it
`);
    process.exit(1);
}

const MAX_ATTEMPT = 2;
const fourk = '4k';
const diff = 'diff'
const collectionId = process.argv[2];
const is4k = process.argv.find(el => el === fourk) || false
const diffMode = process.argv.find(el => el === diff) || false

const getCollectionUrl = id => page => `https://www.artstation.com/collections/${id}/projects.json?collection_id=${id}&page=${page}`;
const fetchJsonPage = async url => (await axios.get(url)).data;

const SANITIZE_REGEX = /[\\\/?"!<>:|?*]/gi
const sanitizeForFs = s => s.replace(SANITIZE_REGEX, ''); // for both windows and linux...
const getLargestArtwork = (s, largest) => s
      .replace('/small_square/', largest ? '/4k/' : '/large/')
      .replace(/\d{14}\//, ''); // ID that we don't need
const getArtwork = s => getLargestArtwork(s, false)

const pickArtworkData = pageArtwork => pageArtwork.data.map(singleArtwork => ({
    title: `${sanitizeForFs(singleArtwork.title)} - ${sanitizeForFs(singleArtwork.user.username)}`,
    link: getLargestArtwork(singleArtwork.cover.small_square_url, is4k),
    backup_link: getArtwork(singleArtwork.cover.small_square_url),
    assets_count: singleArtwork.assets_count,
})).map(artwork => ({
    ...artwork,
    skip_dl: diffMode && isDownloaded(artwork.title)
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
    const failures = []
    artworksInfo.reduce(async (prevDownload, {title, link, skip_dl, backup_link}) => {
        await prevDownload;
        if (skip_dl) {
            console.log(`[dl] ${title} skipped : already downloaded`);
            return Promise.resolve();
        }

        let tryCount = MAX_ATTEMPT;
        while (tryCount > 0) {
            try {
                await downloadArtwork(title, tryCount === MAX_ATTEMPT ? link : backup_link);
                console.log(`[dl] ${title} from ${link}`);
                break;
            } catch (err) {
                tryCount -= 1;
                if (tryCount === 0) {
                    console.log(`[dl] ${title} link: ${link} download failure`)
                    failures.push({title, link})
                }
            }
        }
    }, Promise.resolve());
}

const exceptFileType = fileName => fileName.split('.')[0]
let downloadedArtworks = []
const isDownloaded = artworkTitle => downloadedArtworks
      .find(dlTitle => dlTitle === artworkTitle)

const fsPreOp = async () => {
    await fs.promises.mkdir(downloadDir, { recursive: true });
    downloadedArtworks = (await fs.promises.readdir(downloadDir))
        .map(title => exceptFileType(title))
}
const getArtworks = async url => {
    const getCollectionPage = getCollectionUrl(url);
    console.log('collection url ', getCollectionPage(1), 'usw...');

    try {
        const firstPage = await fetchJsonPage(getCollectionPage(1));
        const totalCount = firstPage.total_count
        let allArtworks = pickArtworkData(firstPage);

        let pageCount = 2;
        while (allArtworks.length !== totalCount) {
            const pageArtwork = await fetchJsonPage(getCollectionPage(pageCount));
            const filteredArtworkInfo = pickArtworkData(pageArtwork);

            allArtworks = allArtworks.concat(filteredArtworkInfo);
            pageCount += 1;
        }
        console.log('artworks nb:', allArtworks.length, 'page nb :', pageCount);

        await downloadAll(allArtworks)
    } catch (err) {
        console.error(err);
    }
}

(async () =>{
    try {
        await fsPreOp()
        await getArtworks(collectionId);
    } catch (error) {
        console.error(error)
    }
})()
