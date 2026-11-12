// @vitest-environment node
/**
 * Statistics Lab engine tests. The reference table below was generated with scipy 1.18.1 and numpy 2.5.4
 * (script: scratchpad genref.py, run with .venv-daily/bin/python) and pasted in as fixed numbers, so these tests need no Python.
 * Tolerance: relative error 1e-9 for every special function and test statistic (absolute error 1e-9 for log gamma, whose reference is 0 at x = 1 and 2);
 * the observed maximum errors are printed by the "observed error" test and recorded in the delivery report.
 */
import { describe, expect, it } from "vitest";
import * as S from "../site/lib/visual/stats";

const REF = {
  "normCdf": [[-8, 6.22096057427174e-16, 0.9999999999999993], [-5, 2.8665157187919344e-07, 0.9999997133484281], [-3.5, 0.00023262907903552502, 0.9997673709209645], [-2.5758293035489004, 0.005000000000000002, 0.995], [-1.96, 0.024997895148220435, 0.9750021048517795], [-1, 0.15865525393145707, 0.8413447460685429], [-0.25, 0.4012936743170763, 0.5987063256829237], [0, 0.5, 0.5], [0.1, 0.539827837277029, 0.460172162722971], [0.5, 0.6914624612740131, 0.3085375387259869], [1, 0.8413447460685429, 0.15865525393145707], [1.644853626951472, 0.95, 0.05000000000000007], [2, 0.9772498680518208, 0.022750131948179198], [3, 0.9986501019683699, 0.001349898031630093], [4.5, 0.9999966023268753, 3.3976731247300543e-06], [6, 0.9999999990134123, 9.865876450376944e-10]],
  "normInv": [[1e-12, -7.034483825301131], [1e-08, -5.612001244174789], [1e-05, -4.264890793922825], [0.001, -3.090232306167813], [0.0125, -2.241402727604945], [0.025, -1.9599639845400545], [0.05, -1.6448536269514729], [0.1, -1.2815515655446004], [0.3, -0.5244005127080409], [0.5, 0.0], [0.7, 0.5244005127080407], [0.9, 1.2815515655446004], [0.95, 1.644853626951472], [0.975, 1.959963984540054], [0.995, 2.5758293035489004], [0.999999, 4.753424308817087]],
  "tCdf": [[1, -10, 0.03172551743055357, 0.06345103486110713], [1, -3, 0.10241638234956672, 0.20483276469913345], [1, -1.5, 0.18716704181099886, 0.3743340836219977], [1, -0.2, 0.4371670418109989, 0.8743340836219978], [1, 0.5, 0.6475836176504333, 0.7048327646991335], [1, 1, 0.75, 0.5000000000000001], [1, 2, 0.8524163823495667, 0.2951672353008665], [1, 2.7, 0.8870936842796503, 0.22581263144069932], [1, 5, 0.9371670418109987, 0.1256659163780024], [1, 12, 0.9735353239404101, 0.052929352119179755], [2, -10, 0.004926228511662845, 0.00985245702332569], [2, -3, 0.04773298313335456, 0.09546596626670913], [2, -1.5, 0.13619656244550055, 0.2723931248910011], [2, -0.2, 0.42998599579859953, 0.8599719915971991], [2, 0.5, 0.6666666666666666, 0.6666666666666667], [2, 1, 0.7886751345948129, 0.4226497308103742], [2, 2, 0.908248290463863, 0.18350341907227394], [2, 2.7, 0.942920632574231, 0.11415873485153798], [2, 5, 0.9811252243246882, 0.037749551350623724], [2, 12, 0.9965635331614208, 0.00687293367715846], [3, -10, 0.0010641995292070751, 0.0021283990584141503], [3, -3, 0.02883444281121865, 0.0576688856224373], [3, -1.5, 0.11529193262241147, 0.23058386524482294], [3, -0.2, 0.4271351646231395, 0.854270329246279], [3, 0.5, 0.6742760175759245, 0.651447964848151], [3, 1, 0.8044988905221148, 0.3910022189557705], [3, 2, 0.9303370157205785, 0.13932596855884305], [3, 2.7, 0.9631069810799697, 0.07378603784006058], [3, 5, 0.9923037809633488, 0.015392438073302294], [3, 12, 0.9993774920996054, 0.0012450158007893362], [5, -10, 8.547378787148179e-05, 0.00017094757574296357], [5, -3, 0.015049623948731288, 0.030099247897462576], [5, -1.5, 0.09695184012123659, 0.19390368024247318], [5, -0.2, 0.4246802569979144, 0.8493605139958288], [5, 0.5, 0.6808505641795355, 0.6382988716409291], [5, 1, 0.8183912661754387, 0.3632174676491227], [5, 2, 0.9490302605850709, 0.10193947882985832], [5, 2.7, 0.9786079683796431, 0.04278406324071367], [5, 5, 0.9979476420099733, 0.004104715980053322], [5, 12, 0.9999645525374142, 7.08949251716152e-05], [10, -10, 7.947765877982065e-07, 1.589553175596413e-06], [10, -3, 0.006671827511284786, 0.013343655022569572], [10, -1.5, 0.08225366322272007, 0.16450732644544014], [10, -0.2, 0.4227445956901727, 0.8454891913803454], [10, 0.5, 0.6860531971285135, 0.627893605742973], [10, 1, 0.8295534338489701, 0.34089313230206], [10, 2, 0.9633059826146299, 0.07338803477074037], [10, 2.7, 0.9888433174182615, 0.02231336516347704], [10, 5, 0.9997313331986217, 0.0005373336027564528], [10, 12, 0.9999998539295588, 2.921408824769984e-07], [30, -10, 2.2876257041148094e-11, 4.575251408229619e-11], [30, -3, 0.0026949820328259727, 0.005389964065651945], [30, -1.5, 0.072032964564323, 0.144065929128646], [30, -0.2, 0.4214150785296623, 0.8428301570593246], [30, 0.5, 0.6896384975574363, 0.6207230048851272], [30, 1, 0.837345692286985, 0.32530861542603], [30, 2, 0.9726874775185085, 0.054625044962983094], [30, 2.7, 0.9943577667446403, 0.01128446651071938], [30, 5, 0.9999883516572665, 2.3296685467007803e-05], [30, 12, 0.999999999999721, 5.580185415199262e-13], [100, -10, 4.9508444922970646e-17, 9.901688984594129e-17], [100, -3, 0.0017039576716647235, 0.003407915343329447], [100, -1.5, 0.06838252906234443, 0.13676505812468887], [100, -0.2, 0.4209433681012254, 0.8418867362024508], [100, 0.5, 0.6909132170845567, 0.6181735658308866], [100, 1, 0.8401379221079384, 0.3197241557841234], [100, 2, 0.9758939106344332, 0.04821217873113366], [100, 2.7, 0.9959282423402956, 0.008143515319408693], [100, 5, 0.9999987749132933, 2.4501734135038024e-06], [100, 12, 1.0, 4.395087715604392e-21]],
  "tInv": [[1, 0.0005, -636.6192487687196], [1, 0.025, -12.706204736174705], [1, 0.1, -3.0776835371752536], [1, 0.5, 0.0], [1, 0.8, 1.3763819204711738], [1, 0.95, 6.313751514675037], [1, 0.975, 12.706204736174694], [1, 0.995, 63.656741162871526], [1, 0.9995, 636.6192487687897], [2, 0.0005, -31.59905457644362], [2, 0.025, -4.302652729749464], [2, 0.1, -1.8856180831641267], [2, 0.5, 0.0], [2, 0.8, 1.0606601717798214], [2, 0.95, 2.9199855803537242], [2, 0.975, 4.302652729749462], [2, 0.995, 9.924843200918287], [2, 0.9995, 31.599054576445365], [3, 0.0005, -12.923978636687481], [3, 0.025, -3.1824463052837086], [3, 0.1, -1.637744353696209], [3, 0.5, 0.0], [3, 0.8, 0.9784723123633042], [3, 0.95, 2.3533634348018233], [3, 0.975, 3.1824463052837078], [3, 0.995, 5.840909309733355], [3, 0.9995, 12.923978636687961], [5, 0.0005, -6.86882662588111], [5, 0.025, -2.5705818356363155], [5, 0.1, -1.4758840488244809], [5, 0.5, 0.0], [5, 0.8, 0.9195437802408267], [5, 0.95, 2.015048373333023], [5, 0.975, 2.5705818356363146], [5, 0.995, 4.032142983555227], [5, 0.9995, 6.868826625881275], [10, 0.0005, -4.586893858702636], [10, 0.025, -2.228138851986275], [10, 0.1, -1.3721836411103356], [10, 0.5, 0.0], [10, 0.8, 0.8790578285505889], [10, 0.95, 1.812461122811676], [10, 0.975, 2.228138851986274], [10, 0.995, 3.16927267261695], [10, 0.9995, 4.586893858702708], [30, 0.0005, -3.6459586350420214], [30, 0.025, -2.042272456301238], [30, 0.1, -1.3104150253913953], [30, 0.5, 0.0], [30, 0.8, 0.8537672614712977], [30, 0.95, 1.6972608865939571], [30, 0.975, 2.0422724563012378], [30, 0.995, 2.7499956535672254], [30, 0.9995, 3.645958635042063], [100, 0.0005, -3.3904913111642294], [100, 0.025, -1.983971518523552], [100, 0.1, -1.290074761346516], [100, 0.5, 0.0], [100, 0.8, 0.8452304244910164], [100, 0.95, 1.6602343260853392], [100, 0.975, 1.983971518523552], [100, 0.995, 2.6258905214380173], [100, 0.9995, 3.390491311164264], [7.5, 0.0005, -5.207725655800546], [7.5, 0.025, -2.333039626864974], [7.5, 0.1, -1.4052118464159529], [7.5, 0.5, 0.0], [7.5, 0.8, 0.8922093469396745], [7.5, 0.95, 1.8757474792112871], [7.5, 0.975, 2.333039626864974], [7.5, 0.995, 3.421422688124044], [7.5, 0.9995, 5.20772565580064], [4.2, 0.0005, -8.14858831387845], [4.2, 0.025, -2.7250727225923748], [4.2, 0.1, -1.519206438446972], [4.2, 0.5, 0.0], [4.2, 0.8, 0.9357917979234462], [4.2, 0.95, 2.1030107450099353], [4.2, 0.975, 2.7250727225923743], [4.2, 0.995, 4.4577703053188795], [4.2, 0.9995, 8.148588313878676]],
  "chi2Cdf": [[1, 0.05, 0.17693672624187864, 0.8230632737581214], [1, 0.5, 0.5204998778130466, 0.47950012218695337], [1, 1, 0.6826894921370859, 0.31731050786291115], [1, 3, 0.9167354833364495, 0.08326451666355052], [1, 7.8, 0.9947753765599386, 0.005224623440061342], [1, 15, 0.9998924888232705, 0.00010751117672950056], [1, 30, 0.9999999567953695, 4.320463057827496e-08], [1, 80, 1.0, 3.7440973842028864e-19], [2, 0.05, 0.02469008797166733, 0.9753099120283326], [2, 0.5, 0.22119921692859512, 0.7788007830714049], [2, 1, 0.3934693402873665, 0.6065306597126334], [2, 3, 0.7768698398515702, 0.22313016014842982], [2, 7.8, 0.9797580885541957, 0.020241911445804395], [2, 15, 0.9994469156298522, 0.0005530843701478337], [2, 30, 0.9999996940976795, 3.0590232050182594e-07], [2, 80, 1.0, 4.248354255291595e-18], [3, 0.05, 0.0029293327646199266, 0.9970706672353801], [3, 0.5, 0.08110858834532418, 0.9188914116546758], [3, 1, 0.19874804309879915, 0.8012519569012009], [3, 3, 0.6083748237289109, 0.3916251762710884], [3, 7.8, 0.9496689021401467, 0.050331097859853346], [3, 15, 0.9981833510334277, 0.0018166489665723223], [3, 30, 0.9999986199429687, 1.3800570312932555e-06], [3, 80, 1.0, 3.0692774861724164e-17], [4, 0.05, 0.0003073401709590146, 0.999692659829041], [4, 0.5, 0.026499021160743912, 0.9735009788392561], [4, 1, 0.09020401043104986, 0.9097959895689501], [4, 3, 0.4421745996289252, 0.5578254003710748], [4, 7.8, 0.9008146339155585, 0.09918536608444149], [4, 15, 0.9952987828537434, 0.004701217146256585], [4, 30, 0.999995105562872, 4.894437128029217e-06], [4, 80, 0.9999999999999998, 1.7418252446695558e-16], [9, 0.05, 1.1560938388384606e-09, 0.9999999988439061], [9, 0.5, 3.0433741161079292e-05, 0.9999695662588389], [9, 1, 0.0005624973021675015, 0.9994375026978325], [9, 3, 0.035705027314910875, 0.9642949726850891], [9, 7.8, 0.44557956412714295, 0.554420435872857], [9, 15, 0.9090640234201949, 0.09093597657980516], [9, 30, 0.9995612782290205, 0.0004387217709794793], [9, 80, 0.9999999999998384, 1.61613141565346e-13], [20, 0.05, 2.569021035717617e-23, 1.0], [20, 0.5, 2.0942485399973623e-13, 0.9999999999997906], [20, 1, 1.709670029348906e-10, 0.999999999829033], [20, 3, 4.0975009763948456e-06, 0.9999959024990236], [20, 7.8, 0.006889621020885047, 0.9931103789791149], [20, 15, 0.22359238698028533, 0.7764076130197146], [20, 30, 0.9301463393005901, 0.06985366069940986], [20, 80, 0.9999999960740678, 3.925932226286192e-09], [60, 0.05, 3.191781793711086e-81, 1.0], [60, 0.5, 2.5673332312832294e-51, 1.0], [60, 1, 2.1644672981498848e-42, 1.0], [60, 3, 1.6948871357554131e-28, 1.0], [60, 7.8, 4.705937583941749e-17, 1.0], [60, 15, 4.897114455785889e-10, 0.9999999995102885], [60, 30, 0.0004184496683276901, 0.9995815503316723], [60, 80, 0.9567713178482644, 0.043228682151735615]],
  "chi2Inv": [[1, 0.001, 1.5707971492624921e-06], [1, 0.05, 0.003932140000019522], [1, 0.5, 0.454936423119572], [1, 0.9, 2.705543454095418], [1, 0.95, 3.8414588206941205], [1, 0.99, 6.634896601021215], [1, 0.999, 10.827566170662733], [2, 0.001, 0.002001000667167068], [2, 0.05, 0.10258658877510106], [2, 0.5, 1.386294361119891], [2, 0.9, 4.605170185988092], [2, 0.95, 5.99146454710798], [2, 0.99, 9.21034037197618], [2, 0.999, 13.815510557964274], [3, 0.001, 0.024297585815692732], [3, 0.05, 0.35184631774927144], [3, 0.5, 2.3659738843753377], [3, 0.9, 6.251388631170322], [3, 0.95, 7.8147279032511765], [3, 0.99, 11.34486673014437], [3, 0.999, 16.26623619623813], [4, 0.001, 0.09080403553897909], [4, 0.05, 0.7107230213973239], [4, 0.5, 3.3566939800333224], [4, 0.9, 7.779440339734858], [4, 0.95, 9.487729036781154], [4, 0.99, 13.276704135987622], [4, 0.999, 18.46682695290317], [9, 0.001, 1.151949546223564], [9, 0.05, 3.325112843066815], [9, 0.5, 8.342832692252953], [9, 0.9, 14.683656573259839], [9, 0.95, 16.918977604620444], [9, 0.99, 21.66599433346192], [9, 0.999, 27.87716487125657], [20, 0.001, 5.9210407454875185], [20, 0.05, 10.850811394182585], [20, 0.5, 19.33742922942826], [20, 0.9, 28.411980584305635], [20, 0.95, 31.410432844230925], [20, 0.99, 37.56623478662506], [20, 0.999, 45.31474661812586], [60, 0.001, 31.7383415942807], [60, 0.05, 43.187958453989765], [60, 0.5, 59.33466627644246], [60, 0.9, 74.3970057193686], [60, 0.95, 79.08194448784874], [60, 0.99, 88.37941890144934], [60, 0.999, 99.6072330698494]],
  "gammaP": [[0.5, 0.1, 0.34527915398142317], [0.5, 1, 0.8427007929497151], [0.5, 5, 0.9984345977419975], [0.5, 12, 0.9999990366429914], [0.5, 40, 1.0], [0.5, 120, 1.0], [0.5, 300, 1.0], [1, 0.1, 0.09516258196404044], [1, 1, 0.6321205588285577], [1, 5, 0.9932620530009145], [1, 12, 0.9999938557876467], [1, 40, 1.0], [1, 120, 1.0], [1, 300, 1.0], [2.5, 0.1, 0.0008861387888124423], [2.5, 1, 0.15085496391539038], [2.5, 5, 0.9247647538534879], [2.5, 12, 0.9997828870565473], [2.5, 40, 0.9999999999999991], [2.5, 120, 1.0], [2.5, 300, 1.0], [10, 0.1, 2.5163478067703154e-17], [10, 1, 1.1142547833872071e-07], [10, 5, 0.03182805730620481], [10, 12, 0.7576078383294875], [10, 40, 0.9999999960740678], [10, 120, 1.0], [10, 300, 1.0], [50, 0.1, 2.980904350473814e-115], [50, 1, 1.2337508979097585e-65], [50, 5, 2.181059214078525e-32], [50, 12, 2.3998794536786187e-16], [50, 40, 0.07033506665939493], [50, 120, 0.9999999999998399], [50, 300, 1.0], [200, 0.1, 0.0], [200, 1, 0.0], [200, 5, 5.452283195135562e-238], [200, 12, 5.68266931103641e-165], [200, 40, 1.7360753266339754e-72], [200, 120, 1.6377841449068907e-11], [200, 300, 0.9999999996628897]],
  "betaI": [[0.5, 0.5, 0.01, 0.06376856085851985], [0.5, 0.5, 0.2, 0.2951672353008665], [0.5, 0.5, 0.5, 0.5000000000000001], [0.5, 0.5, 0.8, 0.7048327646991335], [0.5, 0.5, 0.99, 0.9362314391414802], [1, 3, 0.01, 0.029701], [1, 3, 0.2, 0.48800000000000004], [1, 3, 0.5, 0.875], [1, 3, 0.8, 0.992], [1, 3, 0.99, 0.999999], [2, 5, 0.01, 0.0014604476049999997], [2, 5, 0.2, 0.3446400000000002], [2, 5, 0.5, 0.890625], [2, 5, 0.8, 0.9984], [2, 5, 0.99, 0.999999999405], [10, 0.5, 0.01, 1.770034965528572e-21], [10, 0.5, 0.2, 1.994982493613097e-08], [10, 0.5, 0.5, 0.00023344743474862218], [10, 0.5, 0.8, 0.03690484293418471], [10, 0.5, 0.99, 0.6579281751567843], [30, 40, 0.01, 2.1646349506126068e-41], [30, 40, 0.2, 8.143500654569944e-06], [30, 40, 0.5, 0.8857998873233515], [30, 40, 0.8, 0.9999999999951097], [30, 40, 0.99, 1.0], [0.5, 15, 0.01, 0.41393503522366437], [0.5, 15, 0.2, 0.9897201794707997], [0.5, 15, 0.5, 0.999993944823616], [0.5, 15, 0.8, 0.999999999994748], [0.5, 15, 0.99, 1.0]],
  "lgamma": [[0.1, 2.252712651734206], [0.5, 0.5723649429247], [1, 0.0], [1.5, -0.12078223763524526], [2, 0.0], [5.5, 3.9578139676187165], [10, 12.801827480081469], [50.3, 145.7372480775525], [170, 701.4372638087372], [500, 2605.115850361734]],
  "binom": [[10, 0.3, 0, 0.02824752490000001, 0.028247524900000005], [10, 0.3, 1, 0.12106082099999993, 0.1493083458999999], [10, 0.3, 5, 0.10291934519999994, 0.9526510126000001], [10, 0.3, 10, 5.9048999999999975e-06, 1.0], [10, 0.3, 20, 0.0, 1.0], [10, 0.3, 45, 0.0, 1.0], [20, 0.5, 0, 9.536743164062508e-07, 9.5367431640625e-07], [20, 0.5, 1, 1.9073486328125e-05, 2.002716064453125e-05], [20, 0.5, 5, 0.014785766601562505, 0.020694732666015625], [20, 0.5, 10, 0.1761970520019531, 0.5880985260009766], [20, 0.5, 20, 9.5367431640625e-07, 1.0], [20, 0.5, 45, 0.0, 1.0], [50, 0.05, 0, 0.07694497527671336, 0.0769449752767133], [50, 0.05, 1, 0.20248677704398263, 0.27943175232069517], [50, 0.05, 5, 0.06584063715436636, 0.9622238270102227], [50, 0.05, 10, 0.00012891724809212251, 0.9999703539504683], [50, 0.05, 20, 9.647136556289616e-14, 0.9999999999999922], [50, 0.05, 45, 4.6596144873590015e-53, 1.0], [60, 0.9, 0, 9.999999999999925e-61, 9.999999999999867e-61], [60, 0.9, 1, 5.39999999999993e-58, 5.409999999999929e-58], [60, 0.9, 5, 3.2249682208799624e-49, 3.2572128561399605e-49], [60, 0.9, 10, 2.628827192456903e-40, 2.687220259890784e-40], [60, 0.9, 20, 5.0963043157968665e-26, 5.387085605086876e-26], [60, 0.9, 45, 0.0004642760725116675, 0.000665663848001485]],
  "poisson": [[0.5, 0, 0.6065306597126334, 0.6065306597126334], [0.5, 1, 0.3032653298563167, 0.9097959895689501], [0.5, 3, 0.012636055410679865, 0.9982483774437092], [0.5, 8, 5.8761418390438375e-08, 0.9999999965645098], [0.5, 20, 2.3775421711883416e-25, 1.0], [0.5, 35, 1.7083240794103627e-51, 1.0], [4, 0, 0.01831563888873418, 0.018315638888734182], [4, 1, 0.07326255555493673, 0.0915781944436709], [4, 3, 0.19536681481316454, 0.43347012036670896], [4, 8, 0.029770181304863145, 0.9786365655120158], [4, 20, 8.277463646553656e-09, 0.9999999980769415], [4, 35, 2.092613971121536e-21, 1.0], [12.5, 0, 3.726653172078671e-06, 3.7266531720786718e-06], [12.5, 1, 4.65831646509834e-05, 5.0309817823062075e-05], [12.5, 3, 0.0012131032461193602, 0.001554557843011069], [12.5, 8, 0.05509073376062302, 0.12491619694467045], [12.5, 20, 0.013286011361537254, 0.9826918824345405], [12.5, 35, 8.890716932094483e-08, 0.9999999536777978], [25, 0, 1.3887943864964021e-11, 1.3887943864964e-11], [25, 1, 3.471985966241e-10, 3.610865404890647e-10], [25, 3, 3.616652048167712e-08, 4.0867589479967445e-08], [25, 8, 5.255783877661868e-05, 7.548264164706458e-05], [25, 20, 0.05191746860849122, 0.18549230269414174], [25, 35, 0.011384281016307743, 0.9775419142541295]],
  "lognorm": [[0, 1, 0.3, 0.6442032573591997, 0.11430004504915153], [0, 1, 1, 0.3989422804014327, 0.5], [0, 1, 2.7, 0.09022354557969653, 0.8397063632364072], [0, 1, 10, 0.0028159018901526803, 0.9893489006582998], [0, 1, 40, 1.1064886956672287e-05, 0.9998873780491842], [1, 0.6, 0.3, 0.002604114728431919, 0.00011972466957584454], [1, 0.6, 1, 0.16579523132124785, 0.047790352272814696], [1, 0.6, 2.7, 0.246245091909786, 0.4955131728212568], [1, 0.6, 10, 0.006299628823501642, 0.9850334747504678], [1, 0.6, 40, 7.23793266755284e-07, 0.9999962933935581], [3, 0.8, 0.3, 1.6759070170033816e-06, 7.402590768295029e-08], [3, 0.8, 1, 0.00044074460295930734, 8.841728520080377e-05], [3, 0.8, 2.7, 0.007945333202362792, 0.006063358973330552], [3, 0.8, 10, 0.03410298539493699, 0.19166730464625586], [3, 0.8, 40, 0.00860492596197016, 0.8054083275076866]],
  "data": {"a": [12.1, 9.8, 11.4, 13.2, 10.9, 12.7, 8.9, 14.1, 11.8, 10.2], "b": [9.5, 10.1, 8.7, 11.0, 9.9, 10.4, 7.8, 12.5, 9.1, 10.0, 8.4, 9.6]},
  "t1": {"two-sided": [2.9709549282921617, 0.015678098218835958, 9.0], "greater": [2.9709549282921617, 0.007839049109417979, 9.0], "less": [2.9709549282921617, 0.992160950890582, 9.0]},
  "t1ci": [10.360249364843487, 12.659750635156513],
  "welch": {"two-sided": [2.8290323648314812, 0.011677329668854925, 16.792173969057707], "greater": [2.8290323648314812, 0.005838664834427462, 16.792173969057707], "less": [2.8290323648314812, 0.9941613351655726, 16.792173969057707]},
  "welchci": [0.446201201067302, 3.073798798932698],
  "z1": {"z": 2.387519633427126, "two": 0.01696249670580563, "greater": 0.008481248352902815, "less": 0.9915187516470971},
  "chiInd": {"table": [[30, 20, 10], [22, 28, 25]], "stat": 7.417582417582418, "p": 0.02450712937679126, "df": 2, "expected": [[23.11111111111111, 21.333333333333332, 15.555555555555555], [28.88888888888889, 26.666666666666668, 19.444444444444443]], "v": 0.2344036154692477},
  "chiGof": {"obs": [8, 12, 9, 14, 7, 10], "stat": 3.4, "p": 0.6385699231037951},
  "chiGof2": {"obs": [18, 22, 60], "probs": [0.2, 0.3, 0.5], "stat": 4.333333333333334, "p": 0.11455884399268768},
  "xy": {"x": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "y": [2.1, 3.9, 6.5, 7.2, 10.8, 12.1, 13.0, 17.5, 17.9, 22.4, 21.0, 30.2]},
  "corr": {"pearson": [0.9779592153396791, 3.947888368125253e-08], "spearman": [0.9930069930069931, 1.3016730560634414e-10], "cov": 29.49090909090909},
  "ols": {"slope": 2.2685314685314686, "intercept": -1.0287878787878793, "r2": 0.9564042268678009, "p": 3.947888368125355e-08, "se": 0.15316031702053529},
  "spTies": [0.10559209893749007, 0.7715754864532709],
  "desc": {"data": [2, 3, 3, 4, 8, 11, 5.5, 100, 7, 3], "mean": 14.65, "median": 4.75, "varPop": 816.5024999999998, "varSample": 907.2249999999999, "sdPop": 28.57450786977791, "sdSample": 30.120175962301413, "q1": 3.0, "q3": 7.75, "p90": 19.89999999999997, "skew": 2.6240032890893623},
  "ci": {"z": [46.080072030919894, 53.919927969080106], "t": [46.36185342754001, 53.63814657245999]},
  "power": [[1, 2, 25, 0.05, 0.7054180011138003], [0.5, 1, 30, 0.01, 0.5646555971496767], [2, 5, 10, 0.1, 0.3538025306433757], [0, 3, 20, 0.05, 0.049999999999999996]]
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const TOL = 1e-9;
const worst: Record<string, number> = {};
function chk(family: string, got: number, want: number, tol = TOL, floor = 1e-300) {
  // `floor` turns the error absolute near zero (log gamma is exactly 0 at x = 1 and 2, where relative error is meaningless).
  const e = Math.abs(got - want) / Math.max(Math.abs(want), floor);
  worst[family] = Math.max(worst[family] ?? 0, e);
  if (!(e <= tol)) throw new Error(`${family}: got ${got}, want ${want}, relative error ${e}`);
}

describe("special functions agree with scipy", () => {
  it("log gamma", () => { for (const [x, w] of REF.lgamma) chk("lgamma", S.lgamma(x), w, TOL, 1); });
  it("regularised incomplete gamma P(a, x)", () => { for (const [a, x, w] of REF.gammaP) chk("gammaP", S.gammaP(a, x), w); });
  it("regularised incomplete beta I_x(a, b)", () => { for (const [a, b, x, w] of REF.betaI) chk("betaI", S.betaI(x, a, b), w); });
  it("normal CDF and upper tail (including 8 standard deviations out)", () => { for (const [x, c, sf] of REF.normCdf) { chk("normCdf", S.normCdf(x), c); chk("normSf", S.normSf(x), sf); } });
  it("normal quantile (percent point function)", () => { for (const [p, w] of REF.normInv) chk("normInv", S.normInv(p), w); });
  it("Student t CDF and two-sided tail", () => { for (const [df, t, c, two] of REF.tCdf) { chk("tCdf", S.tCdf(t, df), c); chk("tTwoSided", S.tTwoSided(t, df), two); } });
  it("Student t quantile, integer and fractional df", () => { for (const [df, p, w] of REF.tInv) { if (Math.abs(w) < 1e-300) continue; chk("tInv", S.tInv(p, df), w); } expect(S.tInv(0.5, 7)).toBe(0); });
  it("chi-square CDF, survival function and quantile", () => {
    for (const [k, x, c, sf] of REF.chi2Cdf) { chk("chi2Cdf", S.chi2Cdf(x, k), c); chk("chi2Sf", S.chi2Sf(x, k), sf); }
    for (const [k, p, w] of REF.chi2Inv) chk("chi2Inv", S.chi2Inv(p, k), w);
  });
  it("binomial, Poisson and lognormal", () => {
    for (const [n, p, k, pmf, cdf] of REF.binom) { chk("binomPmf", S.binomPmf(k, n, p), pmf, pmf < 1e-12 ? 1e-6 : TOL); chk("binomCdf", S.binomCdf(k, n, p), cdf, 1e-9); }
    for (const [l, k, pmf, cdf] of REF.poisson) { chk("poissonPmf", S.poissonPmf(k, l), pmf, pmf < 1e-12 ? 1e-6 : TOL); chk("poissonCdf", S.poissonCdf(k, l), cdf); }
    for (const [mu, s, x, pdf, cdf] of REF.lognorm) { chk("lognormPdf", S.lognormPdf(x, mu, s), pdf); chk("lognormCdf", S.lognormCdf(x, mu, s), cdf); }
  });
  it("quantile functions invert the CDFs", () => {
    for (const p of [0.001, 0.2, 0.5, 0.93]) { expect(S.normCdf(S.normInv(p))).toBeCloseTo(p, 12); expect(S.tCdf(S.tInv(p, 6), 6)).toBeCloseTo(p, 12); expect(S.chi2Cdf(S.chi2Inv(p, 4), 4)).toBeCloseTo(p, 12); }
  });
  it("observed error (maximum relative error per function family against scipy)", () => {
    const rows = Object.entries(worst).map(([k, v]) => `${k}=${v.toExponential(2)}`).join("  ");
    console.log(`[stats] tolerance ${TOL}; max observed relative error: ${rows}`);
    expect(Object.keys(worst).length).toBeGreaterThan(15);
    expect(Math.max(...Object.values(worst))).toBeLessThanOrEqual(TOL);
  });
});

describe("tests, intervals and descriptive statistics agree with scipy / numpy", () => {
  const { a, b } = REF.data;
  it("one-sample t, three alternatives, and its confidence interval", () => {
    for (const alt of ["two-sided", "greater", "less"] as const) { const r = S.tTest1(a, 10, alt), [t, p, df] = REF.t1[alt]; chk("t1.stat", r.stat, t); chk("t1.p", r.p, p); expect(r.df).toBe(df); }
    const r = S.tTest1(a, 10, "two-sided");
    chk("t1.ci", r.ci![0], REF.t1ci[0]); chk("t1.ci", r.ci![1], REF.t1ci[1]);
  });
  it("Welch t-test: statistic, fractional df, p-values, interval", () => {
    for (const alt of ["two-sided", "greater", "less"] as const) { const r = S.welchTest(a, b, alt), [t, p, df] = REF.welch[alt]; chk("welch.stat", r.stat, t); chk("welch.df", r.df!, df); chk("welch.p", r.p, p); }
    const r = S.welchTest(a, b, "two-sided");
    chk("welch.ci", r.ci![0], REF.welchci[0]); chk("welch.ci", r.ci![1], REF.welchci[1]);
  });
  it("one-sample z-test", () => {
    const z = S.zTest1(a, 10, 2, "two-sided");
    chk("z1.stat", z.stat, REF.z1.z); chk("z1.p", z.p, REF.z1.two);
    chk("z1.p", S.zTest1(a, 10, 2, "greater").p, REF.z1.greater); chk("z1.p", S.zTest1(a, 10, 2, "less").p, REF.z1.less);
  });
  it("chi-square independence: statistic, df, p, expected counts, Cramer's V", () => {
    const r = S.chi2Independence(REF.chiInd.table);
    chk("chi.stat", r.stat, REF.chiInd.stat); chk("chi.p", r.p, REF.chiInd.p); expect(r.df).toBe(REF.chiInd.df); chk("chi.v", r.cramersV!, REF.chiInd.v);
    r.expected!.forEach((row, i) => row.forEach((e, j) => chk("chi.expected", e, REF.chiInd.expected[i][j])));
  });
  it("chi-square goodness of fit, equal and unequal proportions", () => {
    const g = S.chi2GoodnessOfFit(REF.chiGof.obs, REF.chiGof.obs.map(() => 1));
    chk("gof.stat", g.stat, REF.chiGof.stat); chk("gof.p", g.p, REF.chiGof.p);
    const g2 = S.chi2GoodnessOfFit(REF.chiGof2.obs, REF.chiGof2.probs);
    chk("gof.stat", g2.stat, REF.chiGof2.stat); chk("gof.p", g2.p, REF.chiGof2.p);
  });
  it("Pearson, Spearman (also with ties), covariance, OLS", () => {
    const { x, y } = REF.xy, pts = x.map((v: number, i: number) => ({ x: v, y: y[i] }));
    chk("pearson", S.pearson(x, y), REF.corr.pearson[0]); chk("pearson.p", S.corrPValue(S.pearson(x, y), x.length), REF.corr.pearson[1]);
    chk("spearman", S.spearman(x, y), REF.corr.spearman[0]);
    chk("cov", S.covarianceSample(x, y), REF.corr.cov);
    const f = S.ols(pts);
    chk("ols.slope", f.slope, REF.ols.slope); chk("ols.intercept", f.intercept, REF.ols.intercept); chk("ols.r2", f.r2, REF.ols.r2); chk("ols.p", f.pSlope, REF.ols.p); chk("ols.se", f.seSlope, REF.ols.se);
    const xt = [1, 2, 2, 3, 4, 4, 4, 5, 9, 30], yt = [5, 3, 3, 8, 1, 1, 2, 9, 4, 5];
    chk("spearman.ties", S.spearman(xt, yt), REF.spTies[0]); chk("spearman.p", S.corrPValue(S.spearman(xt, yt), xt.length), REF.spTies[1]);
  });
  it("descriptive statistics: mean, median, n versus n - 1 variance, percentiles, skewness", () => {
    const d = REF.desc, r = S.describe(d.data);
    chk("desc.mean", r.mean, d.mean); chk("desc.median", r.median, d.median); chk("desc.varPop", r.varPop, d.varPop); chk("desc.varSample", r.varSample, d.varSample);
    chk("desc.sdPop", r.sdPop, d.sdPop); chk("desc.sdSample", r.sdSample, d.sdSample); chk("desc.q1", r.q1, d.q1); chk("desc.q3", r.q3, d.q3); chk("desc.p90", S.quantile(d.data, 0.9), d.p90); chk("desc.skew", r.skew, d.skew);
    expect(r.varSample / r.varPop).toBeCloseTo(d.data.length / (d.data.length - 1), 12);
  });
  it("z and t confidence intervals", () => {
    const z = S.zInterval(50, 10, 25, 0.95), t = S.tInterval(50, 8, 15, 0.9);
    chk("ci.z", z.lo, REF.ci.z[0]); chk("ci.z", z.hi, REF.ci.z[1]); chk("ci.t", t.lo, REF.ci.t[0]); chk("ci.t", t.hi, REF.ci.t[1]);
  });
  it("power of a z-test", () => { for (const [d, s, n, al, w] of REF.power) chk("power", S.powerZ(d, s, n, al), w); });
  it("the observed error line for tests (max relative error)", () => {
    const rows = Object.entries(worst).filter(([k]) => /^(t1|welch|z1|chi|gof|pearson|spearman|cov|ols|desc|ci|power)/.test(k)).map(([k, v]) => `${k}=${v.toExponential(2)}`).join("  ");
    console.log(`[stats] tests/descriptive max observed relative error: ${rows}`);
    expect(Object.keys(worst).some((k) => k.startsWith("welch"))).toBe(true);
  });
});

describe("reproducible randomness", () => {
  it("the same seed gives the same sequence; a different seed does not", () => {
    const a = S.makeRng(5), b = S.makeRng(5), c = S.makeRng(6);
    const xs = Array.from({ length: 5 }, () => a.u()), ys = Array.from({ length: 5 }, () => b.u());
    expect(xs).toEqual(ys); expect(xs).not.toEqual(Array.from({ length: 5 }, () => c.u()));
  });
  it("normal draws have mean near 0 and sd near 1", () => {
    const r = S.makeRng(1), xs = Array.from({ length: 20000 }, () => r.normal());
    expect(Math.abs(S.mean(xs))).toBeLessThan(0.03); expect(Math.abs(S.sdSample(xs) - 1)).toBeLessThan(0.03);
  });
  it("every simulation is deterministic given its seed", () => {
    expect(S.simulateEvent("coin", 1000, 3)).toEqual(S.simulateEvent("coin", 1000, 3));
    expect(S.coverageSim({ pop: "normal", n: 10, conf: 0.95, reps: 100, seed: 1, method: "t" })).toEqual(S.coverageSim({ pop: "normal", n: 10, conf: 0.95, reps: 100, seed: 1, method: "t" }));
    expect(S.errorSim({ delta: 1, sigma: 2, n: 25, alpha: 0.05, reps: 300, seed: 4 })).toEqual(S.errorSim({ delta: 1, sigma: 2, n: 25, alpha: 0.05, reps: 300, seed: 4 }));
    const pop = S.makePopulation("skewed", 2000);
    expect(S.samplingDistribution(pop, 20, 200, 9).means).toEqual(S.samplingDistribution(pop, 20, 200, 9).means);
  });
});

describe("distribution explorer", () => {
  it("every distribution's theoretical mean and variance match its own pmf/pdf by numeric integration", () => {
    for (const spec of S.DISTRIBUTIONS) {
      const d = S.makeDist(spec.id, S.defaultParams(spec.id));
      let m = 0, m2 = 0, mass = 0;
      if (d.discrete) for (let k = 0; k <= d.hi + 60; k++) { const p = d.pdf(k); mass += p; m += k * p; m2 += k * k * p; }
      else { const hi = d.hi * 4, N = 200000, h = (hi - d.lo) / N; for (let i = 0; i < N; i++) { const x = d.lo + (i + 0.5) * h, p = d.pdf(x) * h; mass += p; m += x * p; m2 += x * x * p; } }
      expect(mass).toBeCloseTo(1, 2); expect(m).toBeCloseTo(d.mean, 1); expect(m2 - m * m).toBeCloseTo(d.variance, 0);
    }
  });
  it("lognormal: mean > median > mode; exponential and normal medians; binomial/Poisson modes sit at the pmf peak", () => {
    const ln = S.makeDist("lognormal", { mu: 1, sigma: 0.6 });
    expect(ln.mean).toBeGreaterThan(ln.median); expect(ln.median).toBeGreaterThan(ln.mode!);
    expect(S.makeDist("exponential", { rate: 2 }).median).toBeCloseTo(Math.LN2 / 2, 12);
    for (const [id, par] of [["binomial", { n: 20, p: 0.3 }], ["poisson", { lambda: 4.5 }]] as const) {
      const d = S.makeDist(id, par); let best = 0; for (let k = 0; k <= d.hi; k++) if (d.pdf(k) > d.pdf(best)) best = k;
      expect(d.mode).toBe(best);
    }
    expect(S.makeDist("uniform", { a: 0, b: 10 }).mode).toBeNull();
  });
  it("sample means track the theoretical mean for each distribution", () => {
    for (const spec of S.DISTRIBUTIONS) { const d = S.makeDist(spec.id, S.defaultParams(spec.id)), r = S.makeRng(12), xs = Array.from({ length: 6000 }, () => d.sample(r)); expect(Math.abs(S.mean(xs) - d.mean)).toBeLessThan(5 * d.sd / Math.sqrt(6000)); }
  });
  it("median is robust to an outlier; the mean is not (d086)", () => {
    const base = [4, 5, 5, 6, 7, 8, 9], withOut = [...base, 90], a = S.describe(base), b = S.describe(withOut);
    expect(b.mean - a.mean).toBeGreaterThan(10); expect(Math.abs(b.median - a.median)).toBeLessThan(1);
    expect(b.outliers).toEqual([90]); expect(a.modes).toEqual([5]);
  });
});

describe("descriptive statistics and the arithmetic steps", () => {
  it("d086 examples: median of 2,3,4,11 is 3.5, 90th percentile of 10,20,30,40,100 is 76", () => {
    expect(S.median([2, 3, 4, 11])).toBe(3.5); expect(S.mean([2, 3, 4, 11])).toBe(5); expect(S.quantile([10, 20, 30, 40, 100], 0.9)).toBeCloseTo(76, 12);
  });
  it("modes: ties, none, single", () => { expect(S.modes([1, 2, 2, 3, 3])).toEqual([2, 3]); expect(S.modes([1, 2, 3])).toEqual([]); expect(S.modes([4, 4, 1])).toEqual([4]); });
  it("steps are consistent with describe(), with n and n - 1 side by side", () => {
    const xs = [2, 3, 3, 4, 8, 11], d = S.describe(xs), steps = S.summarySteps(xs);
    expect(steps.length).toBe(8);
    const dev = steps.find((s) => s.rows)!.rows!;
    expect(S.sum(dev.map((r) => r.sq))).toBeCloseTo(d.varPop * xs.length, 10);
    expect(S.sum(dev.map((r) => r.dev))).toBeCloseTo(0, 10);
    expect(steps[6].text).toContain(String(Math.round(d.varPop * 10000) / 10000)); expect(steps[7].text).toContain(String(Math.round(d.varSample * 10000) / 10000));
    expect(d.varSample).toBeGreaterThan(d.varPop);
  });
  it("why n - 1: dividing by n underestimates the population variance on average, dividing by n - 1 does not", () => {
    const d = S.varianceBiasDemo(5, 20000, 3, 10);
    expect(d.trueVariance).toBe(100);
    expect(Math.abs(d.meanDivN - 80)).toBeLessThan(3); // (n - 1) / n x 100
    expect(Math.abs(d.meanDivNMinus1 - 100)).toBeLessThan(3.5);
    expect(d.meanDivN).toBeLessThan(d.meanDivNMinus1);
  });
  it("parseNumbers accepts separators and reports what it could not read", () => {
    expect(S.parseNumbers("1, 2.5;3\n-4  5e1")).toEqual({ values: [1, 2.5, 3, -4, 50], bad: [] });
    expect(S.parseNumbers("1, x, 3")).toEqual({ values: [1, 3], bad: ["x"] });
    expect(S.parseNumbers("")).toEqual({ values: [], bad: [] });
  });
  it("histogram counts add to n", () => { const xs = Array.from({ length: 101 }, (_, i) => i * 0.37), h = S.histogram(xs, 9); expect(S.sum(h.counts)).toBe(101); });
});

describe("probability", () => {
  it("the law of large numbers: error at 5000 trials is smaller than the error scale at 10 trials, for every event", () => {
    for (const e of S.EVENTS) {
      const { checkpoints, theory } = S.simulateEvent(e.id, 5000, 21), last = checkpoints[checkpoints.length - 1];
      expect(last.n).toBe(5000); expect(last.hits / last.n).toBeCloseTo(last.proportion, 12);
      expect(last.error).toBeLessThan(4 * Math.sqrt((theory * (1 - theory)) / 5000));
    }
  });
  it("theoretical probabilities of the events are exact", () => { expect(S.EVENTS.map((e) => e.theory)).toEqual([0.5, 1 / 6, 1 / 6, 0.25, 1 / 13]); });
  it("Bayes: natural-frequency table adds up, and positives-by-counting equals Bayes' formula", () => {
    const t = S.bayesTable({ population: 10000, prevalence: 0.01, sensitivity: 0.9, specificity: 0.95 });
    expect(t.sick).toBe(100); expect(t.healthy).toBe(9900); expect(t.truePositive).toBeCloseTo(90, 9); expect(t.falsePositive).toBeCloseTo(495, 9);
    expect(t.truePositive + t.falseNegative).toBeCloseTo(t.sick, 9); expect(t.falsePositive + t.trueNegative).toBeCloseTo(t.healthy, 9);
    expect(t.positives + t.negatives).toBeCloseTo(10000, 9);
    expect(t.ppv).toBeCloseTo(t.ppvBayes, 12); expect(t.ppv).toBeCloseTo(90 / 585, 12);
    expect(t.npv).toBeCloseTo(9405 / (9405 + 10), 12);
  });
  it("conditional probability on two dice by enumeration; independence check", () => {
    const c = S.diceConditional("sum7", "first-even");
    expect(c.a).toBe(6); expect(c.b).toBe(18); expect(c.both).toBe(3); expect(c.pAgivenB).toBeCloseTo(3 / 18, 12);
    expect(c.independent).toBe(true); // P(sum 7 and even first) = 3/36 = (6/36)(18/36)
    const d = S.diceConditional("doubles", "sum-even"); expect(d.independent).toBe(false); expect(d.pAgivenB).toBeCloseTo(6 / 18, 12);
    expect(S.diceConditional("sum9", "first-big").pAgivenB).toBeCloseTo(S.diceConditional("sum9", "first-big").pAandB / S.diceConditional("sum9", "first-big").pB, 12);
  });
});

describe("sampling, the central limit theorem and confidence intervals", () => {
  it("standard error of the mean matches sigma / sqrt(n); means of a skewed population become more symmetric as n grows", () => {
    const pop = S.makePopulation("skewed", 10000, 2024), small = S.samplingDistribution(pop, 2, 3000, 1), big = S.samplingDistribution(pop, 50, 3000, 1);
    expect(Math.abs(big.empiricalSe - big.theoreticalSe) / big.theoreticalSe).toBeLessThan(0.05);
    expect(Math.abs(small.empiricalSe - small.theoreticalSe) / small.theoreticalSe).toBeLessThan(0.06);
    expect(Math.abs(big.meanOfMeans - big.popMean)).toBeLessThan(4 * big.theoreticalSe / Math.sqrt(3000) + 0.05);
    expect(small.skewOfPop).toBeGreaterThan(1); expect(big.skewOfMeans).toBeLessThan(small.skewOfMeans); expect(Math.abs(big.skewOfMeans)).toBeLessThan(0.6);
  });
  it("coverage: 100 seeded t-intervals from a normal population cover about 95%; the count is the number whose interval holds the true mean", () => {
    let total = 0;
    for (let s = 1; s <= 20; s++) { const r = S.coverageSim({ pop: "normal", n: 12, conf: 0.95, reps: 100, seed: s, method: "t" }); total += r.covered; expect(r.covered).toBe(r.intervals.filter((i) => r.trueMean >= i.lo && r.trueMean <= i.hi).length); expect(r.rate).toBe(r.covered / 100); }
    expect(total / 2000).toBeGreaterThan(0.93); expect(total / 2000).toBeLessThan(0.97);
  });
  it("z-interval with the true sigma also covers about its confidence level; 80% covers less than 99%", () => {
    const avg = (conf: number) => { let t = 0; for (let s = 1; s <= 20; s++) t += S.coverageSim({ pop: "normal", n: 15, conf, reps: 100, seed: 100 + s, method: "z" }).covered; return t / 2000; };
    expect(Math.abs(avg(0.8) - 0.8)).toBeLessThan(0.04); expect(avg(0.99)).toBeGreaterThan(0.97);
  });
  it("t intervals are wider than z intervals for the same data, and the gap closes as n grows", () => {
    const w = (n: number) => S.tInterval(50, 10, n, 0.95).margin / S.zInterval(50, 10, n, 0.95).margin;
    expect(w(5)).toBeGreaterThan(1.3); expect(w(5)).toBeGreaterThan(w(30)); expect(w(1000)).toBeLessThan(1.01);
  });
});

describe("hypothesis tests, errors and power", () => {
  it("p-value regions, critical values and decisions are consistent", () => {
    const r = S.tTest1([5.1, 4.9, 5.6, 5.8, 6.0, 5.4, 5.9], 5, "two-sided");
    const reg = S.pValueRegions("t", r.stat, "two-sided", 60, -60);
    expect(reg).toHaveLength(2); expect(reg[1][0]).toBeCloseTo(Math.abs(r.stat), 12);
    const [c1, c2] = S.criticalValues("t", r.df, 0.05, "two-sided"); expect(c2).toBeCloseTo(S.tInv(0.975, r.df!), 12); expect(c1).toBeCloseTo(-c2, 12);
    expect(S.decide(r.p, 0.05)).toBe(r.p < 0.05 ? "reject H0" : "fail to reject H0"); expect(S.decide(0.05, 0.05)).toBe("fail to reject H0");
    // area under the null density over the shaded region equals the p-value
    const pdf = S.nullPdf("t", r.df); let area = 0; const N = 40000;
    for (const [a, b] of reg) { const w = (b - a) / N; for (let i = 0; i < N; i++) area += pdf(a + (i + 0.5) * w) * w; }
    expect(area).toBeCloseTo(r.p, 3);
    const [nlo, nhi] = S.nullRange("t", r.df, r.stat); expect(nlo).toBeLessThan(-Math.abs(r.stat)); expect(nhi).toBeGreaterThan(Math.abs(r.stat));
  });
  it("one-sided p-values: greater + less = 1 and two-sided = 2 x min", () => {
    const xs = [1.2, 2.2, 0.7, 3.1, 2.8, 1.9], g = S.tTest1(xs, 1, "greater"), l = S.tTest1(xs, 1, "less"), t = S.tTest1(xs, 1, "two-sided");
    expect(g.p + l.p).toBeCloseTo(1, 12); expect(t.p).toBeCloseTo(2 * Math.min(g.p, l.p), 12);
  });
  it("Type I error: under a true null, about alpha of seeded tests reject; Type II = 1 - power; simulation matches exact power", () => {
    const r = S.errorSim({ delta: 1, sigma: 2, n: 25, alpha: 0.05, reps: 4000, seed: 8 });
    expect(Math.abs(r.typeIRate - 0.05)).toBeLessThan(0.015);
    expect(Math.abs(r.powerSim - r.powerExact)).toBeLessThan(0.03); expect(r.typeIISim).toBeCloseTo(1 - r.powerSim, 12);
    // power rises with n and with effect size, falls with a stricter alpha; zero effect gives power = alpha
    expect(S.powerZ(1, 2, 100, 0.05)).toBeGreaterThan(S.powerZ(1, 2, 25, 0.05)); expect(S.powerZ(2, 2, 25, 0.05)).toBeGreaterThan(S.powerZ(1, 2, 25, 0.05));
    expect(S.powerZ(1, 2, 25, 0.01)).toBeLessThan(S.powerZ(1, 2, 25, 0.05)); expect(S.powerZ(0, 2, 25, 0.05)).toBeCloseTo(0.05, 12);
  });
  it("chi-square independence: a table built to be independent gives chi-square 0 and p 1", () => {
    const r = S.chi2Independence([[10, 20, 30], [20, 40, 60]]); expect(r.stat).toBeCloseTo(0, 12); expect(r.p).toBeCloseTo(1, 12); expect(r.cramersV).toBeCloseTo(0, 12);
    expect(S.chi2Independence([[2, 3], [3, 2]]).minExpected).toBeLessThan(5);
  });
});

describe("correlation and regression", () => {
  it("curved monotonic data: Spearman is exactly 1, Pearson is below 1", () => {
    const pts = S.relationPoints("curved"), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    expect(S.spearman(xs, ys)).toBeCloseTo(1, 12); expect(S.pearson(xs, ys)).toBeLessThan(0.97);
  });
  it("an outlier cuts r and R squared, and Spearman moves less than Pearson", () => {
    const pts = S.relationPoints("outlier"), clean = pts.slice(0, -1);
    const all = S.ols(pts), without = S.ols(clean);
    expect(without.r2).toBeGreaterThan(0.9); expect(all.r2).toBeLessThan(without.r2 - 0.2); expect(all.slope).toBeLessThan(without.slope);
    const dp = S.pearson(clean.map((p) => p.x), clean.map((p) => p.y)) - S.pearson(pts.map((p) => p.x), pts.map((p) => p.y));
    const ds = S.spearman(clean.map((p) => p.x), clean.map((p) => p.y)) - S.spearman(pts.map((p) => p.x), pts.map((p) => p.y));
    expect(ds).toBeLessThan(dp);
  });
  it("OLS properties: residuals sum to 0, are uncorrelated with x, R squared = 1 - SSE/SST = r squared", () => {
    const pts = S.relationPoints("linear"), f = S.ols(pts);
    expect(S.sum(f.residuals)).toBeCloseTo(0, 9); expect(Math.abs(S.pearson(pts.map((p) => p.x), f.residuals))).toBeLessThan(1e-9);
    expect(f.r2).toBeCloseTo(1 - f.sse / f.sst, 12); expect(f.r2).toBeCloseTo(f.r * f.r, 12);
  });
  it("correlation is not causation: ice cream and drownings correlate strongly, yet the partial correlation given temperature is near zero", () => {
    const { pts, temps } = S.causationData(), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    expect(S.pearson(xs, ys)).toBeGreaterThan(0.7); expect(S.corrPValue(S.pearson(xs, ys), xs.length)).toBeLessThan(0.001);
    expect(Math.abs(S.partialCorrelation(xs, ys, temps))).toBeLessThan(0.45); expect(Math.abs(S.partialCorrelation(xs, ys, temps))).toBeLessThan(S.pearson(xs, ys) - 0.3);
  });
});

describe("presets", () => {
  it("have unique ids, cover every tab, and resolve", () => {
    const ids = S.PRESETS.map((p) => p.id); expect(new Set(ids).size).toBe(ids.length);
    for (const t of S.TABS) expect(S.PRESETS.some((p) => p.tab === t.id)).toBe(true);
    for (const id of ["normal", "bayes", "clt", "coverage", "welch", "chi-square", "errors-power", "causation", "outliers", "variance"]) expect(S.presetById(id)).toBeDefined();
    expect(S.presetById("nope")).toBeUndefined();
  });
});
