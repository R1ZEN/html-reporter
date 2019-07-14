'use strict';

const fs = require('fs-extra');
const utils = require('lib/server-utils');
const reporterHelpers = require('lib/reporter-helpers');
const HermioneTestAdapter = require('lib/test-adapter/hermione-test-adapter');

describe('ImagesSaver', () => {
    const sandbox = sinon.createSandbox();
    let imagesSaver;

    beforeEach(() => {
        const ImagesSaver = require('lib/images-saver');
        imagesSaver = new ImagesSaver();
        delete require.cache['/Users/rostik404/projects/html-reporter/lib/images-saver.js'];
        sandbox.stub(fs, 'readFile').returns(new Buffer(''));
        sandbox.stub(fs, 'copy');
        sandbox.stub(utils, 'copyImageAsync');
        sandbox.stub(utils, 'getReferenceAbsolutePath');
        sandbox.stub(utils, 'getImagesFor');
        sandbox.stub(utils, 'makeDirFor');
        sandbox.stub(utils, 'getDiffAbsolutePath');
        sandbox.stub(reporterHelpers, 'saveTestCurrentImage');
    });

    const mkImageDiffError = (opts = {}) => {
        return Object.assign({currImg: {path: 'default/curr/img.png'}, refImg: {path: 'default/ref/img.png'}}, opts);
    };

    afterEach(() => sandbox.restore());

    describe('saveDiffImg', () => {
        it('should save current image', async () => {
            const workers = {saveDiffTo: sandbox.stub()};
            const testResult = sinon.createStubInstance(HermioneTestAdapter);
            testResult.getRefImg.withArgs('plain').returns({path: 'ref/img.png'});

            utils.getDiffAbsolutePath
                .withArgs({some: 'res'}, '/absolute', '/plain').returns('/absolute/plain/diff.png');
            imagesSaver.setTestResult(testResult);
            await imagesSaver.saveDiffImg(
                mkImageDiffError(),
                {workers, stateName: 'plain', reportPath: '/absolute'}
            );

            assert.calledOnceWith(reporterHelpers.saveTestCurrentImage, testResult, '/absolute', 'plain');
        });

        it('should save diff image in workers', async () => {
            const workers = {saveDiffTo: sandbox.stub()};
            const testResult = sinon.createStubInstance(HermioneTestAdapter);

            utils.getDiffAbsolutePath
                .withArgs(testResult, '/absolute', 'plain').returns('/absolute/plain/diff.png');
            const imageDiffError = mkImageDiffError({currImg: {path: 'curr/img.png'}, refImg: {path: 'ref/img.png'}});
            testResult.getRefImg.withArgs('plain').returns({path: 'ref/img.png'});
            imagesSaver.setTestResult(testResult);
            await imagesSaver.saveDiffImg(
                imageDiffError,
                {workers, stateName: 'plain', reportPath: '/absolute'}
            );

            assert.calledOnceWith(workers.saveDiffTo, imageDiffError, '/absolute/plain/diff.png');
        });

        it('should save reference image', async () => {
            const workers = {saveDiffTo: sandbox.stub()};
            const testResult = sinon.createStubInstance(HermioneTestAdapter);

            utils.getReferenceAbsolutePath
                .withArgs(testResult, '/absolute', 'plain').returns('/absolute/plain/ref.png');
            testResult.getRefImg.withArgs('plain').returns({path: 'ref/img.png'});
            imagesSaver.setTestResult(testResult);
            await imagesSaver.saveDiffImg(
                mkImageDiffError(),
                {workers, stateName: 'plain', reportPath: '/absolute'}
            );

            assert.calledOnceWith(utils.copyImageAsync, 'ref/img.png', '/absolute/plain/ref.png');
        });
    });

    describe('saveRef', () => {
        it('should save reference image', async () => {
            const testResult = sinon.createStubInstance(HermioneTestAdapter);

            utils.getReferenceAbsolutePath
                .withArgs(testResult, '/absolute', 'plain').returns('/absolute/plain/ref.png');
            testResult.getRefImg.withArgs('plain').returns({path: 'ref/img.png'});
            imagesSaver.setTestResult(testResult);
            await imagesSaver.saveRef('plain', '/absolute');

            assert.calledOnceWith(utils.copyImageAsync, 'ref/img.png', '/absolute/plain/ref.png');
        });
    });

    describe('saveCurrImg', () => {
        it('should save current image', async () => {
            const testResult = sinon.createStubInstance(HermioneTestAdapter);
            testResult.getRefImg.withArgs('plain').returns({path: 'ref/img.png'});

            utils.getDiffAbsolutePath
                .withArgs({some: 'res'}, '/absolute', '/plain').returns('/absolute/plain/diff.png');
            imagesSaver.setTestResult(testResult);
            await imagesSaver.saveCurrImg('plain', '/absolute');

            assert.calledOnceWith(reporterHelpers.saveTestCurrentImage, testResult, '/absolute', 'plain');
        });
    });
});
