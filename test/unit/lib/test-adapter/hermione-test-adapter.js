'use strict';

const _ = require('lodash');
const utils = require('lib/server-utils');
const {stubTool, stubConfig} = require('../../utils');
const proxyquire = require('proxyquire');
const fs = require('fs-extra');

describe('hermione test adapter', () => {
    const sandbox = sinon.sandbox.create();
    let tmp, HermioneTestResultAdapter;

    class ImageDiffError extends Error {}
    class NoRefImageError extends Error {}

    const mkHermioneTestResultAdapter = (testResult, toolOpts = {}, htmlReporter) => {
        const config = _.defaults(toolOpts.config, {
            browsers: {
                bro: {}
            }
        });
        const tool = stubTool(stubConfig(config), {}, {ImageDiffError, NoRefImageError}, htmlReporter);

        return new HermioneTestResultAdapter(testResult, tool);
    };

    beforeEach(() => {
        tmp = {tmpdir: 'default/dir'};
        HermioneTestResultAdapter = proxyquire('../../../../lib/test-adapter/hermione-test-adapter', {tmp});
        sandbox.stub(utils, 'getCurrentPath').returns('');
        sandbox.stub(utils, 'getDiffPath').returns('');
        sandbox.stub(fs, 'readFile').resolves(Buffer.from(''));
        sandbox.stub(fs, 'copy').resolves();
    });

    afterEach(() => sandbox.restore());

    it('should return suite attempt', () => {
        const testResult = {retriesLeft: 0, browserId: 'bro'};
        const config = {
            retry: 0,
            browsers: {
                bro: {retry: 5}
            }
        };

        const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult, {config});

        assert.equal(hermioneTestAdapter.attempt, 4);
    });

    it('should return test error with "message", "stack" and "stateName"', () => {
        const testResult = {
            err: {
                message: 'some-message', stack: 'some-stack', stateName: 'some-test', foo: 'bar'
            }
        };

        const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult);

        assert.deepEqual(hermioneTestAdapter.error, {
            message: 'some-message',
            stack: 'some-stack',
            stateName: 'some-test'
        });
    });

    it('should return test state', () => {
        const testResult = {title: 'some-test'};

        const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult);

        assert.deepEqual(hermioneTestAdapter.state, {name: 'some-test'});
    });

    it('should return assert view results', () => {
        const testResult = {assertViewResults: [1]};

        const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult);

        assert.deepEqual(hermioneTestAdapter.assertViewResults, [1]);
    });

    describe('saveTestImages', () => {
        let err;

        beforeEach(() => {
            err = new ImageDiffError();
            err.stateName = 'plain';
            err.currImg = {path: 'curr/path'};
            err.refImg = {path: 'ref/path'};
        });

        it('should build diff to tmp dir', async () => {
            tmp.tmpdir = 'tmp/dir';
            const testResult = {
                id: () => '',
                assertViewResults: [err]
            };
            utils.getDiffPath.returns('diff/report/path');

            const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult, {}, {});
            const workers = {saveDiffTo: sandbox.stub()};
            await hermioneTestAdapter.saveTestImages('', workers);

            assert.calledOnceWith(workers.saveDiffTo, err, sinon.match('tmp/dir/diff/report/path'));
        });

        it('should save diff in report from tmp dir using external storage', async () => {
            tmp.tmpdir = 'tmp/dir';
            const testResult = {
                id: () => '',
                assertViewResults: [err]
            };
            utils.getDiffPath.returns('diff/report/path');
            const externalStorage = {saveImg: sandbox.stub()};
            const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult, {}, {externalStorage});
            const workers = {saveDiffTo: sandbox.stub()};
            await hermioneTestAdapter.saveTestImages('', workers);

            assert.calledWith(
                externalStorage.saveImg,
                sinon.match('tmp/dir/diff/report/path'),
                sinon.match('diff/report/path')
            );
        });
    });

    describe('hasDiff()', () => {
        it('should return true if test has image diff errors', () => {
            const testResult = {assertViewResults: [new ImageDiffError()]};

            const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult, {errors: {ImageDiffError}});

            assert.isTrue(hermioneTestAdapter.hasDiff());
        });

        it('should return false if test has not image diff errors', () => {
            const testResult = {assertViewResults: [new Error()]};

            const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult, {errors: {ImageDiffError}});

            assert.isFalse(hermioneTestAdapter.hasDiff());
        });
    });

    it('should return image dir', () => {
        const testResult = {id: () => 'some-id'};

        const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult);

        assert.deepEqual(hermioneTestAdapter.imageDir, 'some-id');
    });

    it('should return description', () => {
        const testResult = {description: 'some-description'};

        const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult);

        assert.deepEqual(hermioneTestAdapter.description, 'some-description');
    });

    [
        {field: 'refImg', method: 'getRefImg'},
        {field: 'currImg', method: 'getCurrImg'}
    ].forEach(({field, method}) => {
        describe(`${method}`, () => {
            it(`should return ${field} from test result`, () => {
                const testResult = {assertViewResults: [
                    {[field]: 'some-value', stateName: 'plain'}
                ]};

                const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult);

                assert.equal(hermioneTestAdapter[method]('plain'), 'some-value');
            });
        });
    });

    describe('getErrImg', () => {
        it('should return error screenshot from test result', () => {
            const testResult = {err: {screenshot: 'some-value'}};

            const hermioneTestAdapter = mkHermioneTestResultAdapter(testResult);

            assert.equal(hermioneTestAdapter.getErrImg(), 'some-value');
        });
    });

    describe('prepareTestResult()', () => {
        it('should return correct "name" field', () => {
            const testResult = {
                root: true,
                title: 'some-title'
            };

            const result = mkHermioneTestResultAdapter(testResult).prepareTestResult();

            assert.propertyVal(result, 'name', 'some-title');
        });

        it('should return correct "suitePath" field', () => {
            const parentSuite = {parent: {root: true}, title: 'root-title'};
            const testResult = {
                parent: parentSuite,
                title: 'some-title'
            };

            const result = mkHermioneTestResultAdapter(testResult).prepareTestResult();

            assert.deepEqual(result.suitePath, ['root-title', 'some-title']);
        });

        it('should return "browserId" field as is', () => {
            const testResult = {
                root: true,
                browserId: 'bro'
            };

            const result = mkHermioneTestResultAdapter(testResult).prepareTestResult();

            assert.propertyVal(result, 'browserId', 'bro');
        });
    });

    describe('getImagesInfo()', () => {
        const mkTestResult_ = (result) => _.defaults(result, {id: () => 'some-id'});

        it('should use images base url from external images saving api', () => {
            sandbox.stub(utils, 'getImagesFor');
            const testResult = {assertViewResults: [1]};

            const hermioneTestAdapter = mkHermioneTestResultAdapter(
                testResult,
                {},
                {externalStorage: {baseImagesUrl: '/base/url'}}
            );
            hermioneTestAdapter.getImagesInfo();

            assert.calledWith(
                utils.getImagesFor,
                'success',
                sinon.match.instanceOf(HermioneTestResultAdapter),
                sinon.match({baseImagesUrl: '/base/url'})
            );
        });

        it('should not reinit "imagesInfo"', () => {
            const testResult = mkTestResult_({imagesInfo: [1, 2]});

            mkHermioneTestResultAdapter(testResult).getImagesInfo();

            assert.deepEqual(testResult.imagesInfo, [1, 2]);
        });

        it('should reinit "imagesInfo" if it was empty', () => {
            const testResult = mkTestResult_({assertViewResults: [1], imagesInfo: []});

            mkHermioneTestResultAdapter(testResult).getImagesInfo();

            assert.lengthOf(testResult.imagesInfo, 1);
        });

        it('should return diffClusters', () => {
            const testResult = mkTestResult_({
                assertViewResults: [{diffClusters: [{left: 0, top: 0, right: 1, bottom: 1}]}],
                imagesInfo: []
            });

            const [{diffClusters}] = mkHermioneTestResultAdapter(testResult).getImagesInfo();

            assert.deepEqual(diffClusters, [{left: 0, top: 0, right: 1, bottom: 1}]);
        });
    });
});
