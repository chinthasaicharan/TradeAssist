"""
search.py — stock search with Nifty 1000 coverage
- At startup: fetches live constituents from NSE public API (cached 24h)
- Fallback: comprehensive static list of ~1000 Nifty 1000 tickers
- Search: multi-word fuzzy match on symbol + company name, ranked by relevance
"""
import re
import asyncio
import logging
import httpx
from fastapi import APIRouter, Query
from models import SearchSuggestion
import cache

log = logging.getLogger(__name__)
router = APIRouter()

# ── Static Nifty 500 list (symbol, company name, exchange) ────────────────
# Source: NSE index constituents — used as fallback when NSE API is unavailable
# fmt: (NSE_SYMBOL.NS, Company Name, Exchange)
NIFTY500_STATIC: list[tuple[str, str, str]] = [
    ("360ONE.NS", "360 ONE WAM Ltd.", "NSE"),
    ("3MINDIA.NS", "3M India Ltd.", "NSE"),
    ("ABB.NS", "ABB India Ltd.", "NSE"),
    ("ACC.NS", "ACC Ltd.", "NSE"),
    ("ACMESOLAR.NS", "ACME Solar Holdings Ltd.", "NSE"),
    ("AIAENG.NS", "AIA Engineering Ltd.", "NSE"),
    ("APLAPOLLO.NS", "APL Apollo Tubes Ltd.", "NSE"),
    ("AUBANK.NS", "AU Small Finance Bank Ltd.", "NSE"),
    ("AWL.NS", "AWL Agri Business Ltd.", "NSE"),
    ("AADHARHFC.NS", "Aadhar Housing Finance Ltd.", "NSE"),
    ("AARTIIND.NS", "Aarti Industries Ltd.", "NSE"),
    ("AAVAS.NS", "Aavas Financiers Ltd.", "NSE"),
    ("ABBOTINDIA.NS", "Abbott India Ltd.", "NSE"),
    ("ACE.NS", "Action Construction Equipment Ltd.", "NSE"),
    ("ACUTAAS.NS", "Acutaas Chemicals Ltd.", "NSE"),
    ("ADANIENSOL.NS", "Adani Energy Solutions Ltd.", "NSE"),
    ("ADANIENT.NS", "Adani Enterprises Ltd.", "NSE"),
    ("ADANIGREEN.NS", "Adani Green Energy Ltd.", "NSE"),
    ("ADANIPORTS.NS", "Adani Ports and Special Economic Zone Ltd.", "NSE"),
    ("ADANIPOWER.NS", "Adani Power Ltd.", "NSE"),
    ("ATGL.NS", "Adani Total Gas Ltd.", "NSE"),
    ("ABCAPITAL.NS", "Aditya Birla Capital Ltd.", "NSE"),
    ("ABFRL.NS", "Aditya Birla Fashion and Retail Ltd.", "NSE"),
    ("ABLBL.NS", "Aditya Birla Lifestyle Brands Ltd.", "NSE"),
    ("ABREL.NS", "Aditya Birla Real Estate Ltd.", "NSE"),
    ("ABSLAMC.NS", "Aditya Birla Sun Life AMC Ltd.", "NSE"),
    ("CPPLUS.NS", "Aditya Infotech Ltd.", "NSE"),
    ("AEGISLOG.NS", "Aegis Logistics Ltd.", "NSE"),
    ("AEGISVOPAK.NS", "Aegis Vopak Terminals Ltd.", "NSE"),
    ("AFCONS.NS", "Afcons Infrastructure Ltd.", "NSE"),
    ("AFFLE.NS", "Affle 3i Ltd.", "NSE"),
    ("AJANTPHARM.NS", "Ajanta Pharmaceuticals Ltd.", "NSE"),
    ("ALKEM.NS", "Alkem Laboratories Ltd.", "NSE"),
    ("ABDL.NS", "Allied Blenders and Distillers Ltd.", "NSE"),
    ("ARE&M.NS", "Amara Raja Energy & Mobility Ltd.", "NSE"),
    ("AMBER.NS", "Amber Enterprises India Ltd.", "NSE"),
    ("AMBUJACEM.NS", "Ambuja Cements Ltd.", "NSE"),
    ("ANANDRATHI.NS", "Anand Rathi Wealth Ltd.", "NSE"),
    ("ANANTRAJ.NS", "Anant Raj Ltd.", "NSE"),
    ("ANGELONE.NS", "Angel One Ltd.", "NSE"),
    ("ANTHEM.NS", "Anthem Biosciences Ltd.", "NSE"),
    ("ANURAS.NS", "Anupam Rasayan India Ltd.", "NSE"),
    ("APARINDS.NS", "Apar Industries Ltd.", "NSE"),
    ("APOLLOHOSP.NS", "Apollo Hospitals Enterprise Ltd.", "NSE"),
    ("APOLLOTYRE.NS", "Apollo Tyres Ltd.", "NSE"),
    ("APTUS.NS", "Aptus Value Housing Finance India Ltd.", "NSE"),
    ("ASAHIINDIA.NS", "Asahi India Glass Ltd.", "NSE"),
    ("ASHOKLEY.NS", "Ashok Leyland Ltd.", "NSE"),
    ("ASIANPAINT.NS", "Asian Paints Ltd.", "NSE"),
    ("ASTERDM.NS", "Aster DM Healthcare Ltd.", "NSE"),
    ("ASTRAL.NS", "Astral Ltd.", "NSE"),
    ("ATHERENERG.NS", "Ather Energy Ltd.", "NSE"),
    ("ATUL.NS", "Atul Ltd.", "NSE"),
    ("AUROPHARMA.NS", "Aurobindo Pharma Ltd.", "NSE"),
    ("AIIL.NS", "Authum Investment & Infrastructure Ltd.", "NSE"),
    ("DMART.NS", "Avenue Supermarts Ltd.", "NSE"),
    ("AXISBANK.NS", "Axis Bank Ltd.", "NSE"),
    ("BEML.NS", "BEML Ltd.", "NSE"),
    ("BLS.NS", "BLS International Services Ltd.", "NSE"),
    ("BSE.NS", "BSE Ltd.", "NSE"),
    ("BAJAJ-AUTO.NS", "Bajaj Auto Ltd.", "NSE"),
    ("BAJFINANCE.NS", "Bajaj Finance Ltd.", "NSE"),
    ("BAJAJFINSV.NS", "Bajaj Finserv Ltd.", "NSE"),
    ("BAJAJHLDNG.NS", "Bajaj Holdings & Investment Ltd.", "NSE"),
    ("BAJAJHFL.NS", "Bajaj Housing Finance Ltd.", "NSE"),
    ("BALKRISIND.NS", "Balkrishna Industries Ltd.", "NSE"),
    ("BALRAMCHIN.NS", "Balrampur Chini Mills Ltd.", "NSE"),
    ("BANDHANBNK.NS", "Bandhan Bank Ltd.", "NSE"),
    ("BANKBARODA.NS", "Bank of Baroda", "NSE"),
    ("BANKINDIA.NS", "Bank of India", "NSE"),
    ("MAHABANK.NS", "Bank of Maharashtra", "NSE"),
    ("BATAINDIA.NS", "Bata India Ltd.", "NSE"),
    ("BAYERCROP.NS", "Bayer Cropscience Ltd.", "NSE"),
    ("BELRISE.NS", "Belrise Industries Ltd.", "NSE"),
    ("BERGEPAINT.NS", "Berger Paints India Ltd.", "NSE"),
    ("BDL.NS", "Bharat Dynamics Ltd.", "NSE"),
    ("BEL.NS", "Bharat Electronics Ltd.", "NSE"),
    ("BHARATFORG.NS", "Bharat Forge Ltd.", "NSE"),
    ("BHEL.NS", "Bharat Heavy Electricals Ltd.", "NSE"),
    ("BPCL.NS", "Bharat Petroleum Corporation Ltd.", "NSE"),
    ("BHARTIARTL.NS", "Bharti Airtel Ltd.", "NSE"),
    ("BHARTIHEXA.NS", "Bharti Hexacom Ltd.", "NSE"),
    ("BIKAJI.NS", "Bikaji Foods International Ltd.", "NSE"),
    ("GROWW.NS", "Billionbrains Garage Ventures Ltd.", "NSE"),
    ("BIOCON.NS", "Biocon Ltd.", "NSE"),
    ("BSOFT.NS", "Birlasoft Ltd.", "NSE"),
    ("BLUEDART.NS", "Blue Dart Express Ltd.", "NSE"),
    ("BLUEJET.NS", "Blue Jet Healthcare Ltd.", "NSE"),
    ("BLUESTARCO.NS", "Blue Star Ltd.", "NSE"),
    ("BBTC.NS", "Bombay Burmah Trading Corporation Ltd.", "NSE"),
    ("BOSCHLTD.NS", "Bosch Ltd.", "NSE"),
    ("FIRSTCRY.NS", "Brainbees Solutions Ltd.", "NSE"),
    ("BRIGADE.NS", "Brigade Enterprises Ltd.", "NSE"),
    ("BRITANNIA.NS", "Britannia Industries Ltd.", "NSE"),
    ("MAPMYINDIA.NS", "C.E. Info Systems Ltd.", "NSE"),
    ("CCL.NS", "CCL Products (I) Ltd.", "NSE"),
    ("CESC.NS", "CESC Ltd.", "NSE"),
    ("CGPOWER.NS", "CG Power and Industrial Solutions Ltd.", "NSE"),
    ("CIEINDIA.NS", "CIE Automotive India Ltd.", "NSE"),
    ("CRISIL.NS", "CRISIL Ltd.", "NSE"),
    ("CANFINHOME.NS", "Can Fin Homes Ltd.", "NSE"),
    ("CANBK.NS", "Canara Bank", "NSE"),
    ("CANHLIFE.NS", "Canara HSBC Life Insurance Company Ltd.", "NSE"),
    ("CAPLIPOINT.NS", "Caplin Point Laboratories Ltd.", "NSE"),
    ("CGCL.NS", "Capri Global Capital Ltd.", "NSE"),
    ("CARBORUNIV.NS", "Carborundum Universal Ltd.", "NSE"),
    ("CARTRADE.NS", "Cartrade Tech Ltd.", "NSE"),
    ("CASTROLIND.NS", "Castrol India Ltd.", "NSE"),
    ("CEATLTD.NS", "Ceat Ltd.", "NSE"),
    ("CEMPRO.NS", "Cemindia Projects Ltd.", "NSE"),
    ("CENTRALBK.NS", "Central Bank of India", "NSE"),
    ("CDSL.NS", "Central Depository Services (India) Ltd.", "NSE"),
    ("CHALET.NS", "Chalet Hotels Ltd.", "NSE"),
    ("CHAMBLFERT.NS", "Chambal Fertilizers & Chemicals Ltd.", "NSE"),
    ("CHENNPETRO.NS", "Chennai Petroleum Corporation Ltd.", "NSE"),
    ("CHOICEIN.NS", "Choice International Ltd.", "NSE"),
    ("CHOLAHLDNG.NS", "Cholamandalam Financial Holdings Ltd.", "NSE"),
    ("CHOLAFIN.NS", "Cholamandalam Investment and Finance Company Ltd.", "NSE"),
    ("CIPLA.NS", "Cipla Ltd.", "NSE"),
    ("CUB.NS", "City Union Bank Ltd.", "NSE"),
    ("CLEAN.NS", "Clean Science and Technology Ltd.", "NSE"),
    ("COALINDIA.NS", "Coal India Ltd.", "NSE"),
    ("COCHINSHIP.NS", "Cochin Shipyard Ltd.", "NSE"),
    ("COFORGE.NS", "Coforge Ltd.", "NSE"),
    ("COHANCE.NS", "Cohance Lifesciences Ltd.", "NSE"),
    ("COLPAL.NS", "Colgate Palmolive (India) Ltd.", "NSE"),
    ("CAMS.NS", "Computer Age Management Services Ltd.", "NSE"),
    ("CONCORDBIO.NS", "Concord Biotech Ltd.", "NSE"),
    ("CONCOR.NS", "Container Corporation of India Ltd.", "NSE"),
    ("COROMANDEL.NS", "Coromandel International Ltd.", "NSE"),
    ("CRAFTSMAN.NS", "Craftsman Automation Ltd.", "NSE"),
    ("CREDITACC.NS", "CreditAccess Grameen Ltd.", "NSE"),
    ("CROMPTON.NS", "Crompton Greaves Consumer Electricals Ltd.", "NSE"),
    ("CUMMINSIND.NS", "Cummins India Ltd.", "NSE"),
    ("CYIENT.NS", "Cyient Ltd.", "NSE"),
    ("DCMSHRIRAM.NS", "DCM Shriram Ltd.", "NSE"),
    ("DLF.NS", "DLF Ltd.", "NSE"),
    ("DOMS.NS", "DOMS Industries Ltd.", "NSE"),
    ("DABUR.NS", "Dabur India Ltd.", "NSE"),
    ("DALBHARAT.NS", "Dalmia Bharat Ltd.", "NSE"),
    ("DATAPATTNS.NS", "Data Patterns (India) Ltd.", "NSE"),
    ("DEEPAKFERT.NS", "Deepak Fertilisers & Petrochemicals Corp. Ltd.", "NSE"),
    ("DEEPAKNTR.NS", "Deepak Nitrite Ltd.", "NSE"),
    ("DELHIVERY.NS", "Delhivery Ltd.", "NSE"),
    ("DEVYANI.NS", "Devyani International Ltd.", "NSE"),
    ("DIVISLAB.NS", "Divi's Laboratories Ltd.", "NSE"),
    ("DIXON.NS", "Dixon Technologies (India) Ltd.", "NSE"),
    ("LALPATHLAB.NS", "Dr. Lal Path Labs Ltd.", "NSE"),
    ("DRREDDY.NS", "Dr. Reddy's Laboratories Ltd.", "NSE"),
    ("EIDPARRY.NS", "E.I.D. Parry (India) Ltd.", "NSE"),
    ("EIHOTEL.NS", "EIH Ltd.", "NSE"),
    ("EICHERMOT.NS", "Eicher Motors Ltd.", "NSE"),
    ("ELECON.NS", "Elecon Engineering Co. Ltd.", "NSE"),
    ("ELGIEQUIP.NS", "Elgi Equipments Ltd.", "NSE"),
    ("EMAMILTD.NS", "Emami Ltd.", "NSE"),
    ("EMCURE.NS", "Emcure Pharmaceuticals Ltd.", "NSE"),
    ("EMMVEE.NS", "Emmvee Photovoltaic Power Ltd.", "NSE"),
    ("ENDURANCE.NS", "Endurance Technologies Ltd.", "NSE"),
    ("ENGINERSIN.NS", "Engineers India Ltd.", "NSE"),
    ("ERIS.NS", "Eris Lifesciences Ltd.", "NSE"),
    ("ESCORTS.NS", "Escorts Kubota Ltd.", "NSE"),
    ("ETERNAL.NS", "Eternal Ltd.", "NSE"),
    ("EXIDEIND.NS", "Exide Industries Ltd.", "NSE"),
    ("NYKAA.NS", "FSN E-Commerce Ventures Ltd.", "NSE"),
    ("FEDERALBNK.NS", "Federal Bank Ltd.", "NSE"),
    ("FACT.NS", "Fertilisers and Chemicals Travancore Ltd.", "NSE"),
    ("FINCABLES.NS", "Finolex Cables Ltd.", "NSE"),
    ("FSL.NS", "Firstsource Solutions Ltd.", "NSE"),
    ("FIVESTAR.NS", "Five-Star Business Finance Ltd.", "NSE"),
    ("FORCEMOT.NS", "Force Motors Ltd.", "NSE"),
    ("FORTIS.NS", "Fortis Healthcare Ltd.", "NSE"),
    ("GAIL.NS", "GAIL (India) Ltd.", "NSE"),
    ("GVT&D.NS", "GE Vernova T&D India Ltd.", "NSE"),
    ("GMRAIRPORT.NS", "GMR Airports Ltd.", "NSE"),
    ("GABRIEL.NS", "Gabriel India Ltd.", "NSE"),
    ("GALLANTT.NS", "Gallantt Ispat Ltd.", "NSE"),
    ("GRSE.NS", "Garden Reach Shipbuilders & Engineers Ltd.", "NSE"),
    ("GICRE.NS", "General Insurance Corporation of India", "NSE"),
    ("GILLETTE.NS", "Gillette India Ltd.", "NSE"),
    ("GLAND.NS", "Gland Pharma Ltd.", "NSE"),
    ("GLAXO.NS", "Glaxosmithkline Pharmaceuticals Ltd.", "NSE"),
    ("GLENMARK.NS", "Glenmark Pharmaceuticals Ltd.", "NSE"),
    ("MEDANTA.NS", "Global Health Ltd.", "NSE"),
    ("GODIGIT.NS", "Go Digit General Insurance Ltd.", "NSE"),
    ("GPIL.NS", "Godawari Power & Ispat Ltd.", "NSE"),
    ("GODFRYPHLP.NS", "Godfrey Phillips India Ltd.", "NSE"),
    ("GODREJCP.NS", "Godrej Consumer Products Ltd.", "NSE"),
    ("GODREJIND.NS", "Godrej Industries Ltd.", "NSE"),
    ("GODREJPROP.NS", "Godrej Properties Ltd.", "NSE"),
    ("GRANULES.NS", "Granules India Ltd.", "NSE"),
    ("GRAPHITE.NS", "Graphite India Ltd.", "NSE"),
    ("GRASIM.NS", "Grasim Industries Ltd.", "NSE"),
    ("GRAVITA.NS", "Gravita India Ltd.", "NSE"),
    ("GESHIP.NS", "Great Eastern Shipping Co. Ltd.", "NSE"),
    ("FLUOROCHEM.NS", "Gujarat Fluorochemicals Ltd.", "NSE"),
    ("GMDCLTD.NS", "Gujarat Mineral Development Corporation Ltd.", "NSE"),
    ("HEG.NS", "H.E.G. Ltd.", "NSE"),
    ("HBLENGINE.NS", "HBL Engineering Ltd.", "NSE"),
    ("HCLTECH.NS", "HCL Technologies Ltd.", "NSE"),
    ("HDBFS.NS", "HDB Financial Services Ltd.", "NSE"),
    ("HDFCAMC.NS", "HDFC Asset Management Company Ltd.", "NSE"),
    ("HDFCBANK.NS", "HDFC Bank Ltd.", "NSE"),
    ("HDFCLIFE.NS", "HDFC Life Insurance Company Ltd.", "NSE"),
    ("HFCL.NS", "HFCL Ltd.", "NSE"),
    ("HAVELLS.NS", "Havells India Ltd.", "NSE"),
    ("HEROMOTOCO.NS", "Hero MotoCorp Ltd.", "NSE"),
    ("HEXT.NS", "Hexaware Technologies Ltd.", "NSE"),
    ("HSCL.NS", "Himadri Speciality Chemical Ltd.", "NSE"),
    ("HINDALCO.NS", "Hindalco Industries Ltd.", "NSE"),
    ("HAL.NS", "Hindustan Aeronautics Ltd.", "NSE"),
    ("HINDCOPPER.NS", "Hindustan Copper Ltd.", "NSE"),
    ("HINDPETRO.NS", "Hindustan Petroleum Corporation Ltd.", "NSE"),
    ("HINDUNILVR.NS", "Hindustan Unilever Ltd.", "NSE"),
    ("HINDZINC.NS", "Hindustan Zinc Ltd.", "NSE"),
    ("POWERINDIA.NS", "Hitachi Energy India Ltd.", "NSE"),
    ("HOMEFIRST.NS", "Home First Finance Company India Ltd.", "NSE"),
    ("HONASA.NS", "Honasa Consumer Ltd.", "NSE"),
    ("HONAUT.NS", "Honeywell Automation India Ltd.", "NSE"),
    ("HUDCO.NS", "Housing & Urban Development Corporation Ltd.", "NSE"),
    ("HYUNDAI.NS", "Hyundai Motor India Ltd.", "NSE"),
    ("ICICIBANK.NS", "ICICI Bank Ltd.", "NSE"),
    ("ICICIGI.NS", "ICICI Lombard General Insurance Company Ltd.", "NSE"),
    ("ICICIAMC.NS", "ICICI Prudential Asset Management Company Ltd.", "NSE"),
    ("ICICIPRULI.NS", "ICICI Prudential Life Insurance Company Ltd.", "NSE"),
    ("IDBI.NS", "IDBI Bank Ltd.", "NSE"),
    ("IDFCFIRSTB.NS", "IDFC First Bank Ltd.", "NSE"),
    ("IFCI.NS", "IFCI Ltd.", "NSE"),
    ("IIFL.NS", "IIFL Finance Ltd.", "NSE"),
    ("IRB.NS", "IRB Infrastructure Developers Ltd.", "NSE"),
    ("IRCON.NS", "IRCON International Ltd.", "NSE"),
    ("ITCHOTELS.NS", "ITC Hotels Ltd.", "NSE"),
    ("ITC.NS", "ITC Ltd.", "NSE"),
    ("ITI.NS", "ITI Ltd.", "NSE"),
    ("INDGN.NS", "Indegene Ltd.", "NSE"),
    ("INDIACEM.NS", "India Cements Ltd.", "NSE"),
    ("INDIAMART.NS", "Indiamart Intermesh Ltd.", "NSE"),
    ("INDIANB.NS", "Indian Bank", "NSE"),
    ("IEX.NS", "Indian Energy Exchange Ltd.", "NSE"),
    ("INDHOTEL.NS", "Indian Hotels Co. Ltd.", "NSE"),
    ("IOC.NS", "Indian Oil Corporation Ltd.", "NSE"),
    ("IOB.NS", "Indian Overseas Bank", "NSE"),
    ("IRCTC.NS", "Indian Railway Catering And Tourism Corporation Ltd.", "NSE"),
    ("IRFC.NS", "Indian Railway Finance Corporation Ltd.", "NSE"),
    ("IREDA.NS", "Indian Renewable Energy Development Agency Ltd.", "NSE"),
    ("IGL.NS", "Indraprastha Gas Ltd.", "NSE"),
    ("INDUSTOWER.NS", "Indus Towers Ltd.", "NSE"),
    ("INDUSINDBK.NS", "IndusInd Bank Ltd.", "NSE"),
    ("NAUKRI.NS", "Info Edge (India) Ltd.", "NSE"),
    ("INFY.NS", "Infosys Ltd.", "NSE"),
    ("INOXWIND.NS", "Inox Wind Ltd.", "NSE"),
    ("INTELLECT.NS", "Intellect Design Arena Ltd.", "NSE"),
    ("INDIGO.NS", "InterGlobe Aviation Ltd.", "NSE"),
    ("IGIL.NS", "International Gemological Institute Ltd.", "NSE"),
    ("IKS.NS", "Inventurus Knowledge Solutions Ltd.", "NSE"),
    ("IPCALAB.NS", "Ipca Laboratories Ltd.", "NSE"),
    ("JBCHEPHARM.NS", "J.B. Chemicals & Pharmaceuticals Ltd.", "NSE"),
    ("JKCEMENT.NS", "J.K. Cement Ltd.", "NSE"),
    ("JBMA.NS", "JBM Auto Ltd.", "NSE"),
    ("JKTYRE.NS", "JK Tyre & Industries Ltd.", "NSE"),
    ("JMFINANCIL.NS", "JM Financial Ltd.", "NSE"),
    ("JSWCEMENT.NS", "JSW Cement Ltd.", "NSE"),
    ("JSWDULUX.NS", "JSW Dulux Ltd.", "NSE"),
    ("JSWENERGY.NS", "JSW Energy Ltd.", "NSE"),
    ("JSWINFRA.NS", "JSW Infrastructure Ltd.", "NSE"),
    ("JSWSTEEL.NS", "JSW Steel Ltd.", "NSE"),
    ("JAINREC.NS", "Jain Resource Recycling Ltd.", "NSE"),
    ("JPPOWER.NS", "Jaiprakash Power Ventures Ltd.", "NSE"),
    ("J&KBANK.NS", "Jammu & Kashmir Bank Ltd.", "NSE"),
    ("JINDALSAW.NS", "Jindal Saw Ltd.", "NSE"),
    ("JSL.NS", "Jindal Stainless Ltd.", "NSE"),
    ("JINDALSTEL.NS", "Jindal Steel Ltd.", "NSE"),
    ("JIOFIN.NS", "Jio Financial Services Ltd.", "NSE"),
    ("JUBLFOOD.NS", "Jubilant Foodworks Ltd.", "NSE"),
    ("JUBLINGREA.NS", "Jubilant Ingrevia Ltd.", "NSE"),
    ("JUBLPHARMA.NS", "Jubilant Pharmova Ltd.", "NSE"),
    ("JWL.NS", "Jupiter Wagons Ltd.", "NSE"),
    ("JYOTICNC.NS", "Jyoti CNC Automation Ltd.", "NSE"),
    ("KPRMILL.NS", "K.P.R. Mill Ltd.", "NSE"),
    ("KEI.NS", "KEI Industries Ltd.", "NSE"),
    ("KPITTECH.NS", "KPIT Technologies Ltd.", "NSE"),
    ("KAJARIACER.NS", "Kajaria Ceramics Ltd.", "NSE"),
    ("KPIL.NS", "Kalpataru Projects International Ltd.", "NSE"),
    ("KALYANKJIL.NS", "Kalyan Jewellers India Ltd.", "NSE"),
    ("KARURVYSYA.NS", "Karur Vysya Bank Ltd.", "NSE"),
    ("KAYNES.NS", "Kaynes Technology India Ltd.", "NSE"),
    ("KEC.NS", "Kec International Ltd.", "NSE"),
    ("KFINTECH.NS", "Kfin Technologies Ltd.", "NSE"),
    ("KIRLOSENG.NS", "Kirloskar Oil Eng Ltd.", "NSE"),
    ("KOTAKBANK.NS", "Kotak Mahindra Bank Ltd.", "NSE"),
    ("KIMS.NS", "Krishna Institute of Medical Sciences Ltd.", "NSE"),
    ("LTF.NS", "L&T Finance Ltd.", "NSE"),
    ("LTTS.NS", "L&T Technology Services Ltd.", "NSE"),
    ("LGEINDIA.NS", "LG Electronics India Ltd.", "NSE"),
    ("LICHSGFIN.NS", "LIC Housing Finance Ltd.", "NSE"),
    ("LTFOODS.NS", "LT Foods Ltd.", "NSE"),
    ("LTM.NS", "LTM Ltd.", "NSE"),
    ("LT.NS", "Larsen & Toubro Ltd.", "NSE"),
    ("LATENTVIEW.NS", "Latent View Analytics Ltd.", "NSE"),
    ("LAURUSLABS.NS", "Laurus Labs Ltd.", "NSE"),
    ("THELEELA.NS", "Leela Palaces Hotels & Resorts Ltd.", "NSE"),
    ("LEMONTREE.NS", "Lemon Tree Hotels Ltd.", "NSE"),
    ("LENSKART.NS", "Lenskart Solutions Ltd.", "NSE"),
    ("LICI.NS", "Life Insurance Corporation of India", "NSE"),
    ("LINDEINDIA.NS", "Linde India Ltd.", "NSE"),
    ("LLOYDSME.NS", "Lloyds Metals And Energy Ltd.", "NSE"),
    ("LODHA.NS", "Lodha Developers Ltd.", "NSE"),
    ("LUPIN.NS", "Lupin Ltd.", "NSE"),
    ("MMTC.NS", "MMTC Ltd.", "NSE"),
    ("MRF.NS", "MRF Ltd.", "NSE"),
    ("MGL.NS", "Mahanagar Gas Ltd.", "NSE"),
    ("M&MFIN.NS", "Mahindra & Mahindra Financial Services Ltd.", "NSE"),
    ("M&M.NS", "Mahindra & Mahindra Ltd.", "NSE"),
    ("MANAPPURAM.NS", "Manappuram Finance Ltd.", "NSE"),
    ("MRPL.NS", "Mangalore Refinery & Petrochemicals Ltd.", "NSE"),
    ("MANKIND.NS", "Mankind Pharma Ltd.", "NSE"),
    ("MARICO.NS", "Marico Ltd.", "NSE"),
    ("MARUTI.NS", "Maruti Suzuki India Ltd.", "NSE"),
    ("MFSL.NS", "Max Financial Services Ltd.", "NSE"),
    ("MAXHEALTH.NS", "Max Healthcare Institute Ltd.", "NSE"),
    ("MAZDOCK.NS", "Mazagoan Dock Shipbuilders Ltd.", "NSE"),
    ("MEESHO.NS", "Meesho Ltd.", "NSE"),
    ("MINDACORP.NS", "Minda Corporation Ltd.", "NSE"),
    ("MSUMI.NS", "Motherson Sumi Wiring India Ltd.", "NSE"),
    ("MOTILALOFS.NS", "Motilal Oswal Financial Services Ltd.", "NSE"),
    ("MPHASIS.NS", "MphasiS Ltd.", "NSE"),
    ("MCX.NS", "Multi Commodity Exchange of India Ltd.", "NSE"),
    ("MUTHOOTFIN.NS", "Muthoot Finance Ltd.", "NSE"),
    ("NATCOPHARM.NS", "NATCO Pharma Ltd.", "NSE"),
    ("NBCC.NS", "NBCC (India) Ltd.", "NSE"),
    ("NCC.NS", "NCC Ltd.", "NSE"),
    ("NHPC.NS", "NHPC Ltd.", "NSE"),
    ("NLCINDIA.NS", "NLC India Ltd.", "NSE"),
    ("NMDC.NS", "NMDC Ltd.", "NSE"),
    ("NSLNISP.NS", "NMDC Steel Ltd.", "NSE"),
    ("NTPCGREEN.NS", "NTPC Green Energy Ltd.", "NSE"),
    ("NTPC.NS", "NTPC Ltd.", "NSE"),
    ("NH.NS", "Narayana Hrudayalaya Ltd.", "NSE"),
    ("NATIONALUM.NS", "National Aluminium Co. Ltd.", "NSE"),
    ("NAVA.NS", "Nava Ltd.", "NSE"),
    ("NAVINFLUOR.NS", "Navin Fluorine International Ltd.", "NSE"),
    ("NESTLEIND.NS", "Nestle India Ltd.", "NSE"),
    ("NETWEB.NS", "Netweb Technologies India Ltd.", "NSE"),
    ("NEULANDLAB.NS", "Neuland Laboratories Ltd.", "NSE"),
    ("NEWGEN.NS", "Newgen Software Technologies Ltd.", "NSE"),
    ("NAM-INDIA.NS", "Nippon Life India Asset Management Ltd.", "NSE"),
    ("NIVABUPA.NS", "Niva Bupa Health Insurance Company Ltd.", "NSE"),
    ("NUVAMA.NS", "Nuvama Wealth Management Ltd.", "NSE"),
    ("NUVOCO.NS", "Nuvoco Vistas Corporation Ltd.", "NSE"),
    ("OBEROIRLTY.NS", "Oberoi Realty Ltd.", "NSE"),
    ("ONGC.NS", "Oil & Natural Gas Corporation Ltd.", "NSE"),
    ("OIL.NS", "Oil India Ltd.", "NSE"),
    ("OLAELEC.NS", "Ola Electric Mobility Ltd.", "NSE"),
    ("OLECTRA.NS", "Olectra Greentech Ltd.", "NSE"),
    ("PAYTM.NS", "One 97 Communications Ltd.", "NSE"),
    ("ONESOURCE.NS", "Onesource Specialty Pharma Ltd.", "NSE"),
    ("OFSS.NS", "Oracle Financial Services Software Ltd.", "NSE"),
    ("POLICYBZR.NS", "PB Fintech Ltd.", "NSE"),
    ("PCBL.NS", "PCBL Chemical Ltd.", "NSE"),
    ("PGEL.NS", "PG Electroplast Ltd.", "NSE"),
    ("PIIND.NS", "PI Industries Ltd.", "NSE"),
    ("PNBHOUSING.NS", "PNB Housing Finance Ltd.", "NSE"),
    ("PTCIL.NS", "PTC Industries Ltd.", "NSE"),
    ("PVRINOX.NS", "PVR INOX Ltd.", "NSE"),
    ("PAGEIND.NS", "Page Industries Ltd.", "NSE"),
    ("PARADEEP.NS", "Paradeep Phosphates Ltd.", "NSE"),
    ("PATANJALI.NS", "Patanjali Foods Ltd.", "NSE"),
    ("PERSISTENT.NS", "Persistent Systems Ltd.", "NSE"),
    ("PETRONET.NS", "Petronet LNG Ltd.", "NSE"),
    ("PFIZER.NS", "Pfizer Ltd.", "NSE"),
    ("PHOENIXLTD.NS", "Phoenix Mills Ltd.", "NSE"),
    ("PWL.NS", "Physicswallah Ltd.", "NSE"),
    ("PIDILITIND.NS", "Pidilite Industries Ltd.", "NSE"),
    ("PINELABS.NS", "Pine Labs Ltd.", "NSE"),
    ("PIRAMALFIN.NS", "Piramal Finance Ltd.", "NSE"),
    ("PPLPHARMA.NS", "Piramal Pharma Ltd.", "NSE"),
    ("POLYMED.NS", "Poly Medicure Ltd.", "NSE"),
    ("POLYCAB.NS", "Polycab India Ltd.", "NSE"),
    ("POONAWALLA.NS", "Poonawalla Fincorp Ltd.", "NSE"),
    ("PFC.NS", "Power Finance Corporation Ltd.", "NSE"),
    ("POWERGRID.NS", "Power Grid Corporation of India Ltd.", "NSE"),
    ("PREMIERENE.NS", "Premier Energies Ltd.", "NSE"),
    ("PRESTIGE.NS", "Prestige Estates Projects Ltd.", "NSE"),
    ("PNB.NS", "Punjab National Bank", "NSE"),
    ("RRKABEL.NS", "R R Kabel Ltd.", "NSE"),
    ("RBLBANK.NS", "RBL Bank Ltd.", "NSE"),
    ("RECLTD.NS", "REC Ltd.", "NSE"),
    ("RHIM.NS", "RHI MAGNESITA INDIA LTD.", "NSE"),
    ("RITES.NS", "RITES Ltd.", "NSE"),
    ("RADICO.NS", "Radico Khaitan Ltd", "NSE"),
    ("RVNL.NS", "Rail Vikas Nigam Ltd.", "NSE"),
    ("RAILTEL.NS", "Railtel Corporation Of India Ltd.", "NSE"),
    ("RAINBOW.NS", "Rainbow Childrens Medicare Ltd.", "NSE"),
    ("RKFORGE.NS", "Ramkrishna Forgings Ltd.", "NSE"),
    ("REDINGTON.NS", "Redington Ltd.", "NSE"),
    ("RELIANCE.NS", "Reliance Industries Ltd.", "NSE"),
    ("RPOWER.NS", "Reliance Power Ltd.", "NSE"),
    ("SBFC.NS", "SBFC Finance Ltd.", "NSE"),
    ("SBICARD.NS", "SBI Cards and Payment Services Ltd.", "NSE"),
    ("SBILIFE.NS", "SBI Life Insurance Company Ltd.", "NSE"),
    ("SJVN.NS", "SJVN Ltd.", "NSE"),
    ("SRF.NS", "SRF Ltd.", "NSE"),
    ("SAGILITY.NS", "Sagility Ltd.", "NSE"),
    ("SAILIFE.NS", "Sai Life Sciences Ltd.", "NSE"),
    ("SAMMAANCAP.NS", "Sammaan Capital Ltd.", "NSE"),
    ("MOTHERSON.NS", "Samvardhana Motherson International Ltd.", "NSE"),
    ("SAPPHIRE.NS", "Sapphire Foods India Ltd.", "NSE"),
    ("SARDAEN.NS", "Sarda Energy and Minerals Ltd.", "NSE"),
    ("SAREGAMA.NS", "Saregama India Ltd", "NSE"),
    ("SCHAEFFLER.NS", "Schaeffler India Ltd.", "NSE"),
    ("SCHNEIDER.NS", "Schneider Electric Infrastructure Ltd.", "NSE"),
    ("SCI.NS", "Shipping Corporation of India Ltd.", "NSE"),
    ("SHREECEM.NS", "Shree Cement Ltd.", "NSE"),
    ("SHRIRAMFIN.NS", "Shriram Finance Ltd.", "NSE"),
    ("SHYAMMETL.NS", "Shyam Metalics and Energy Ltd.", "NSE"),
    ("ENRIN.NS", "Siemens Energy India Ltd.", "NSE"),
    ("SIEMENS.NS", "Siemens Ltd.", "NSE"),
    ("SIGNATURE.NS", "Signatureglobal (India) Ltd.", "NSE"),
    ("SOBHA.NS", "Sobha Ltd.", "NSE"),
    ("SOLARINDS.NS", "Solar Industries India Ltd.", "NSE"),
    ("SONACOMS.NS", "Sona BLW Precision Forgings Ltd.", "NSE"),
    ("SONATSOFTW.NS", "Sonata Software Ltd.", "NSE"),
    ("STARHEALTH.NS", "Star Health and Allied Insurance Company Ltd.", "NSE"),
    ("SBIN.NS", "State Bank of India", "NSE"),
    ("SAIL.NS", "Steel Authority of India Ltd.", "NSE"),
    ("SUMICHEM.NS", "Sumitomo Chemical India Ltd.", "NSE"),
    ("SUNPHARMA.NS", "Sun Pharmaceutical Industries Ltd.", "NSE"),
    ("SUNTV.NS", "Sun TV Network Ltd.", "NSE"),
    ("SUNDARMFIN.NS", "Sundaram Finance Ltd.", "NSE"),
    ("SUPREMEIND.NS", "Supreme Industries Ltd.", "NSE"),
    ("SPLPETRO.NS", "Supreme Petrochem Ltd.", "NSE"),
    ("SUZLON.NS", "Suzlon Energy Ltd.", "NSE"),
    ("SWANCORP.NS", "Swan Corp Ltd.", "NSE"),
    ("SWIGGY.NS", "Swiggy Ltd.", "NSE"),
    ("SYNGENE.NS", "Syngene International Ltd.", "NSE"),
    ("SYRMA.NS", "Syrma SGS Technology Ltd.", "NSE"),
    ("TBOTEK.NS", "TBO Tek Ltd.", "NSE"),
    ("TVSMOTOR.NS", "TVS Motor Company Ltd.", "NSE"),
    ("TATACAP.NS", "Tata Capital Ltd.", "NSE"),
    ("TATACHEM.NS", "Tata Chemicals Ltd.", "NSE"),
    ("TATACOMM.NS", "Tata Communications Ltd.", "NSE"),
    ("TCS.NS", "Tata Consultancy Services Ltd.", "NSE"),
    ("TATACONSUM.NS", "Tata Consumer Products Ltd.", "NSE"),
    ("TATAELXSI.NS", "Tata Elxsi Ltd.", "NSE"),
    ("TATAINVEST.NS", "Tata Investment Corporation Ltd.", "NSE"),
    ("TMCV.NS", "Tata Motors Ltd.", "NSE"),
    ("TMPV.NS", "Tata Motors Passenger Vehicles Ltd.", "NSE"),
    ("TATAPOWER.NS", "Tata Power Co. Ltd.", "NSE"),
    ("TATASTEEL.NS", "Tata Steel Ltd.", "NSE"),
    ("TATATECH.NS", "Tata Technologies Ltd.", "NSE"),
    ("TTML.NS", "Tata Teleservices (Maharashtra) Ltd.", "NSE"),
    ("TECHM.NS", "Tech Mahindra Ltd.", "NSE"),
    ("TECHNOE.NS", "Techno Electric & Engineering Company Ltd.", "NSE"),
    ("TEGA.NS", "Tega Industries Ltd.", "NSE"),
    ("TEJASNET.NS", "Tejas Networks Ltd.", "NSE"),
    ("TENNIND.NS", "Tenneco Clean Air India Ltd.", "NSE"),
    ("NIACL.NS", "The New India Assurance Company Ltd.", "NSE"),
    ("RAMCOCEM.NS", "The Ramco Cements Ltd.", "NSE"),
    ("THERMAX.NS", "Thermax Ltd.", "NSE"),
    ("TIMKEN.NS", "Timken India Ltd.", "NSE"),
    ("TITAGARH.NS", "Titagarh Rail Systems Ltd.", "NSE"),
    ("TITAN.NS", "Titan Company Ltd.", "NSE"),
    ("TORNTPHARM.NS", "Torrent Pharmaceuticals Ltd.", "NSE"),
    ("TORNTPOWER.NS", "Torrent Power Ltd.", "NSE"),
    ("TARIL.NS", "Transformers And Rectifiers (India) Ltd.", "NSE"),
    ("TRAVELFOOD.NS", "Travel Food Services Ltd.", "NSE"),
    ("TRENT.NS", "Trent Ltd.", "NSE"),
    ("TRIDENT.NS", "Trident Ltd.", "NSE"),
    ("TRITURBINE.NS", "Triveni Turbine Ltd.", "NSE"),
    ("TIINDIA.NS", "Tube Investments of India Ltd.", "NSE"),
    ("UCOBANK.NS", "UCO Bank", "NSE"),
    ("UNOMINDA.NS", "UNO Minda Ltd.", "NSE"),
    ("UPL.NS", "UPL Ltd.", "NSE"),
    ("UTIAMC.NS", "UTI Asset Management Company Ltd.", "NSE"),
    ("ULTRACEMCO.NS", "UltraTech Cement Ltd.", "NSE"),
    ("UNIONBANK.NS", "Union Bank of India", "NSE"),
    ("UBL.NS", "United Breweries Ltd.", "NSE"),
    ("UNITDSPR.NS", "United Spirits Ltd.", "NSE"),
    ("URBANCO.NS", "Urban Company Ltd.", "NSE"),
    ("USHAMART.NS", "Usha Martin Ltd.", "NSE"),
    ("VTL.NS", "Vardhman Textiles Ltd.", "NSE"),
    ("VBL.NS", "Varun Beverages Ltd.", "NSE"),
    ("VAML.NS", "Vedanta Aluminium Metal Ltd.", "NSE"),
    ("VEDL.NS", "Vedanta Ltd.", "NSE"),
    ("VOGL.NS", "Vedanta Oil and Gas Ltd.", "NSE"),
    ("VIJAYA.NS", "Vijaya Diagnostic Centre Ltd.", "NSE"),
    ("VMM.NS", "Vishal Mega Mart Ltd.", "NSE"),
    ("IDEA.NS", "Vodafone Idea Ltd.", "NSE"),
    ("VOLTAS.NS", "Voltas Ltd.", "NSE"),
    ("WAAREEENER.NS", "Waaree Energies Ltd.", "NSE"),
    ("WELCORP.NS", "Welspun Corp Ltd.", "NSE"),
    ("WELSPUNLIV.NS", "Welspun Living Ltd.", "NSE"),
    ("WHIRLPOOL.NS", "Whirlpool of India Ltd.", "NSE"),
    ("WIPRO.NS", "Wipro Ltd.", "NSE"),
    ("WOCKPHARMA.NS", "Wockhardt Ltd.", "NSE"),
    ("YESBANK.NS", "Yes Bank Ltd.", "NSE"),
    ("ZFCVINDIA.NS", "ZF Commercial Vehicle Control Systems India Ltd.", "NSE"),
    ("ZEEL.NS", "Zee Entertainment Enterprises Ltd.", "NSE"),
    ("ZENTEC.NS", "Zen Technologies Ltd.", "NSE"),
    ("ZENSARTECH.NS", "Zensar Technolgies Ltd.", "NSE"),
    ("ZYDUSLIFE.NS", "Zydus Lifesciences Ltd.", "NSE"),
    ("ZYDUSWELL.NS", "Zydus Wellness Ltd.", "NSE"),
    ("ECLERX.NS", "eClerx Services Ltd.", "NSE"),

    # ── Commonly searched mid/smallcaps not in Nifty 500 ──────────────────
    ("SHAKTIPUMP.NS", "Shakti Pumps (India) Ltd.", "NSE"),
    ("GNFC.NS", "Gujarat Narmada Valley Fertilizers & Chemicals Ltd.", "NSE"),
    ("JYOTHYLAB.NS", "Jyothy Labs Ltd.", "NSE"),
    ("FLUOROCHEM.NS", "Gujarat Fluorochemicals Ltd.", "NSE"),
    ("GSFC.NS", "Gujarat State Fertilizers & Chemicals Ltd.", "NSE"),
    ("HAPPSTMNDS.NS", "Happiest Minds Technologies Ltd.", "NSE"),
    ("IRFC.NS", "Indian Railway Finance Corporation Ltd.", "NSE"),
    ("JINDALSAW.NS", "Jindal Saw Ltd.", "NSE"),
    ("LINDEINDIA.NS", "Linde India Ltd.", "NSE"),
    ("MMTC.NS", "MMTC Ltd.", "NSE"),
    ("MOTHERSUMI.NS", "Motherson Sumi Systems Ltd.", "NSE"),
    ("NOCIL.NS", "NOCIL Ltd.", "NSE"),
    ("ORIENTELEC.NS", "Orient Electric Ltd.", "NSE"),
    ("RAYMOND.NS", "Raymond Ltd.", "NSE"),
    ("RITES.NS", "RITES Ltd.", "NSE"),
    ("STLTECH.NS", "Sterlite Technologies Ltd.", "NSE"),
    ("SYMPHONY.NS", "Symphony Ltd.", "NSE"),
    ("TEAMLEASE.NS", "TeamLease Services Ltd.", "NSE"),
    ("TTML.NS", "Tata Teleservices (Maharashtra) Ltd.", "NSE"),
    ("UJJIVANSFB.NS", "Ujjivan Small Finance Bank Ltd.", "NSE"),
    ("VGUARD.NS", "V-Guard Industries Ltd.", "NSE"),
    ("VAIBHAVGBL.NS", "Vaibhav Global Ltd.", "NSE"),
    ("VSTIND.NS", "VST Industries Ltd.", "NSE"),
    ("AARTIIND.NS", "Aarti Industries Ltd.", "NSE"),
    ("ACCELYA.NS", "Accelya Solutions India Ltd.", "NSE"),
    ("BALARAMCHIN.NS", "Balrampur Chini Mills Ltd.", "NSE"),
    ("CIGNITITEC.NS", "Cigniti Technologies Ltd.", "NSE"),
    ("CENTURYPLY.NS", "Century Plyboards (India) Ltd.", "NSE"),
    ("FINEORG.NS", "Fine Organic Industries Ltd.", "NSE"),
    ("GALAXYSURF.NS", "Galaxy Surfactants Ltd.", "NSE"),
    ("GLAXO.NS", "GlaxoSmithKline Pharmaceuticals Ltd.", "NSE"),
    ("GTLINFRA.NS", "GTL Infrastructure Ltd.", "NSE"),
    ("HGINFRA.NS", "H.G. Infra Engineering Ltd.", "NSE"),
    ("IOLCP.NS", "IOL Chemicals and Pharmaceuticals Ltd.", "NSE"),
    ("JINDALSTEEL.NS", "Jindal Steel & Power Ltd.", "NSE"),
    ("KSCL.NS", "Kaveri Seed Company Ltd.", "NSE"),
    ("NAVNETEDUL.NS", "Navneet Education Ltd.", "NSE"),
    ("NRBBEARING.NS", "NRB Bearings Ltd.", "NSE"),
    ("PDSL.NS", "PDS Ltd.", "NSE"),
    ("PGHL.NS", "Procter & Gamble Health Ltd.", "NSE"),
    ("PRSMJOHNSN.NS", "Prism Johnson Ltd.", "NSE"),
    ("RAJESHEXPO.NS", "Rajesh Exports Ltd.", "NSE"),
    ("RESPONIND.NS", "Responsive Industries Ltd.", "NSE"),
    ("RELAXO.NS", "Relaxo Footwears Ltd.", "NSE"),
    ("ROSSARI.NS", "Rossari Biotech Ltd.", "NSE"),
    ("SEQUENT.NS", "Sequent Scientific Ltd.", "NSE"),
    ("SHREDIGCEM.NS", "Shree Digvijay Cement Co. Ltd.", "NSE"),
    ("SUBROS.NS", "Subros Ltd.", "NSE"),
    ("SURYAROSNI.NS", "Surya Roshni Ltd.", "NSE"),
    ("TIDEWATER.NS", "Tide Water Oil Co. (India) Ltd.", "NSE"),
    ("UNIVASTU.NS", "Univastu India Ltd.", "NSE"),
    ("VENKEYS.NS", "Venky's (India) Ltd.", "NSE"),
    ("VESUVIUS.NS", "Vesuvius India Ltd.", "NSE"),
    ("WABAG.NS", "VA Tech Wabag Ltd.", "NSE"),

    # ── Nifty Smallcap 250 additions (stocks not already in Nifty 500) ─────
    # Source: NSE Nifty Smallcap 250 constituents (July 2026)
    ("PRIMEFOCUS.NS", "Prime Focus Ltd.", "NSE"),
    ("IDBI.NS", "IDBI Bank Ltd.", "NSE"),
    ("CHENNPETRO.NS", "Chennai Petroleum Corporation Ltd.", "NSE"),
    ("GESHIP.NS", "Great Eastern Shipping Co. Ltd.", "NSE"),
    ("BBTC.NS", "Bombay Burmah Trading Corporation Ltd.", "NSE"),
    ("UCOBANK.NS", "UCO Bank", "NSE"),
    ("J&KBANK.NS", "Jammu & Kashmir Bank Ltd.", "NSE"),
    ("IOB.NS", "Indian Overseas Bank", "NSE"),
    ("CENTRALBK.NS", "Central Bank of India", "NSE"),
    ("MRPL.NS", "Mangalore Refinery & Petrochemicals Ltd.", "NSE"),
    ("SPLPETRO.NS", "Supreme Petrochem Ltd.", "NSE"),
    ("CEATLTD.NS", "Ceat Ltd.", "NSE"),
    ("JKTYRE.NS", "JK Tyre & Industries Ltd.", "NSE"),
    ("WELCORP.NS", "Welspun Corp Ltd.", "NSE"),
    ("WELSPUNLIV.NS", "Welspun Living Ltd.", "NSE"),
    ("KIRLOSENG.NS", "Kirloskar Oil Eng Ltd.", "NSE"),
    ("HFCL.NS", "HFCL Ltd.", "NSE"),
    ("EMMVEE.NS", "Emmvee Photovoltaic Power Ltd.", "NSE"),
    ("VIJAYA.NS", "Vijaya Diagnostic Centre Ltd.", "NSE"),
    ("GALLANTT.NS", "Gallantt Ispat Ltd.", "NSE"),
    ("JAINREC.NS", "Jain Resource Recycling Ltd.", "NSE"),
    ("SYRMA.NS", "Syrma SGS Technology Ltd.", "NSE"),
    ("CARTRADE.NS", "Cartrade Tech Ltd.", "NSE"),
    ("RKFORGE.NS", "Ramkrishna Forgings Ltd.", "NSE"),
    ("SCHNEIDER.NS", "Schneider Electric Infrastructure Ltd.", "NSE"),
    ("GRAPHITE.NS", "Graphite India Ltd.", "NSE"),
    ("CLEAN.NS", "Clean Science and Technology Ltd.", "NSE"),
    ("GLAND.NS", "Gland Pharma Ltd.", "NSE"),
    ("STARHEALTH.NS", "Star Health and Allied Insurance Company Ltd.", "NSE"),
    ("HEG.NS", "H.E.G. Ltd.", "NSE"),
    ("FINOLEXIND.NS", "Finolex Industries Ltd.", "NSE"),
    ("SCI.NS", "Shipping Corporation of India Ltd.", "NSE"),
    ("PIRAMALFIN.NS", "Piramal Finance Ltd.", "NSE"),
    ("IIFL.NS", "IIFL Finance Ltd.", "NSE"),
    ("INDIACEM.NS", "India Cements Ltd.", "NSE"),
    ("SOBHA.NS", "Sobha Ltd.", "NSE"),
    ("DEEPAKFERT.NS", "Deepak Fertilisers & Petrochemicals Corp. Ltd.", "NSE"),
    ("DEEPAKNTR.NS", "Deepak Nitrite Ltd.", "NSE"),
    ("GABRIEL.NS", "Gabriel India Ltd.", "NSE"),
    ("OLECTRA.NS", "Olectra Greentech Ltd.", "NSE"),
    ("POLYMED.NS", "Poly Medicure Ltd.", "NSE"),
    ("GRANULES.NS", "Granules India Ltd.", "NSE"),
    ("CANHLIFE.NS", "Canara HSBC Life Insurance Company Ltd.", "NSE"),
    ("ZENSARTECH.NS", "Zensar Technologies Ltd.", "NSE"),
    ("JUBLINGREA.NS", "Jubilant Ingrevia Ltd.", "NSE"),
    ("ZYDUSWELL.NS", "Zydus Wellness Ltd.", "NSE"),
    ("NUVOCO.NS", "Nuvoco Vistas Corporation Ltd.", "NSE"),
    ("LALPATHLAB.NS", "Dr. Lal Path Labs Ltd.", "NSE"),
    ("AMBER.NS", "Amber Enterprises India Ltd.", "NSE"),
    ("PFIZER.NS", "Pfizer Ltd.", "NSE"),
    ("WHIRLPOOL.NS", "Whirlpool of India Ltd.", "NSE"),
    ("MINDACORP.NS", "Minda Corporation Ltd.", "NSE"),
    ("JPPOWER.NS", "Jaiprakash Power Ventures Ltd.", "NSE"),
    ("GPIL.NS", "Godawari Power & Ispat Ltd.", "NSE"),
    ("FIRSTCRY.NS", "Brainbees Solutions Ltd.", "NSE"),
    ("NIVABUPA.NS", "Niva Bupa Health Insurance Company Ltd.", "NSE"),
    ("KPIL.NS", "Kalpataru Projects International Ltd.", "NSE"),
    ("IRCON.NS", "IRCON International Ltd.", "NSE"),
    ("PARADEEP.NS", "Paradeep Phosphates Ltd.", "NSE"),
    ("INOXWIND.NS", "Inox Wind Ltd.", "NSE"),
    ("GMDCLTD.NS", "Gujarat Mineral Development Corporation Ltd.", "NSE"),
    ("DELHIVERY.NS", "Delhivery Ltd.", "NSE"),
    ("NAVINFLUOR.NS", "Navin Fluorine International Ltd.", "NSE"),
    ("SWANCORP.NS", "Swan Corp Ltd.", "NSE"),
    ("NSLNISP.NS", "NMDC Steel Ltd.", "NSE"),
    ("BLS.NS", "BLS International Services Ltd.", "NSE"),
    ("CGCL.NS", "Capri Global Capital Ltd.", "NSE"),
    ("TATATECH.NS", "Tata Technologies Ltd.", "NSE"),
    ("TTML.NS", "Tata Teleservices (Maharashtra) Ltd.", "NSE"),
    ("GODIGIT.NS", "Go Digit General Insurance Ltd.", "NSE"),
    ("MMTC.NS", "MMTC Ltd.", "NSE"),
    ("USHAMART.NS", "Usha Martin Ltd.", "NSE"),
    ("CHALET.NS", "Chalet Hotels Ltd.", "NSE"),
    ("EMCURE.NS", "Emcure Pharmaceuticals Ltd.", "NSE"),
    ("CREDITACC.NS", "CreditAccess Grameen Ltd.", "NSE"),
    ("MGL.NS", "Mahanagar Gas Ltd.", "NSE"),
    ("IGIL.NS", "International Gemological Institute Ltd.", "NSE"),
    ("RAILTEL.NS", "Railtel Corporation Of India Ltd.", "NSE"),
    ("JMFINANCIL.NS", "JM Financial Ltd.", "NSE"),
    ("JBMA.NS", "JBM Auto Ltd.", "NSE"),
    ("AAVAS.NS", "Aavas Financiers Ltd.", "NSE"),
    ("TEGA.NS", "Tega Industries Ltd.", "NSE"),
    ("DATAPATTNS.NS", "Data Patterns (India) Ltd.", "NSE"),
    ("NETWEB.NS", "Netweb Technologies India Ltd.", "NSE"),
    ("FORCEMOT.NS", "Force Motors Ltd.", "NSE"),
    ("FACT.NS", "Fertilisers and Chemicals Travancore Ltd.", "NSE"),
    ("PCBL.NS", "PCBL Chemical Ltd.", "NSE"),
    ("RAMCOCEM.NS", "The Ramco Cements Ltd.", "NSE"),
    ("CROMPTON.NS", "Crompton Greaves Consumer Electricals Ltd.", "NSE"),
    ("JSWDULUX.NS", "JSW Dulux Ltd.", "NSE"),
    ("PINELABS.NS", "Pine Labs Ltd.", "NSE"),
    ("KAYNES.NS", "Kaynes Technology India Ltd.", "NSE"),
    ("TEJASNET.NS", "Tejas Networks Ltd.", "NSE"),
    ("IEX.NS", "Indian Energy Exchange Ltd.", "NSE"),
    ("CARBORUNIV.NS", "Carborundum Universal Ltd.", "NSE"),
    ("PPLPHARMA.NS", "Piramal Pharma Ltd.", "NSE"),
    ("ASHOKLEY.NS", "Ashok Leyland Ltd.", "NSE"),
    ("CONCORDBIO.NS", "Concord Biotech Ltd.", "NSE"),
    ("TRIDENT.NS", "Trident Ltd.", "NSE"),
    ("IRCTC.NS", "Indian Railway Catering And Tourism Corporation Ltd.", "NSE"),
    ("JINDALSAW.NS", "Jindal Saw Ltd.", "NSE"),
    ("AADHARHFC.NS", "Aadhar Housing Finance Ltd.", "NSE"),
    ("DOMS.NS", "DOMS Industries Ltd.", "NSE"),
    ("SAPPHIRE.NS", "Sapphire Foods India Ltd.", "NSE"),
    ("CASTROLIND.NS", "Castrol India Ltd.", "NSE"),
    ("NBCC.NS", "NBCC (India) Ltd.", "NSE"),
    ("ANURAS.NS", "Anupam Rasayan India Ltd.", "NSE"),
    ("KARURVYSYA.NS", "Karur Vysya Bank Ltd.", "NSE"),
    ("IKS.NS", "Inventurus Knowledge Solutions Ltd.", "NSE"),
    ("BANDHANBNK.NS", "Bandhan Bank Ltd.", "NSE"),
    ("CESC.NS", "CESC Ltd.", "NSE"),
    ("KEC.NS", "Kec International Ltd.", "NSE"),
    ("REDINGTON.NS", "Redington Ltd.", "NSE"),
    ("SONATSOFTW.NS", "Sonata Software Ltd.", "NSE"),
    ("TBOTEK.NS", "TBO Tek Ltd.", "NSE"),
    ("BLUEDART.NS", "Blue Dart Express Ltd.", "NSE"),
    ("FSL.NS", "Firstsource Solutions Ltd.", "NSE"),
    ("BAYERCROP.NS", "Bayer Cropscience Ltd.", "NSE"),
    ("GILLETTE.NS", "Gillette India Ltd.", "NSE"),
    ("CHOICEIN.NS", "Choice International Ltd.", "NSE"),
    ("ONESOURCE.NS", "Onesource Specialty Pharma Ltd.", "NSE"),
    ("CIEINDIA.NS", "CIE Automotive India Ltd.", "NSE"),
    ("SAMMAANCAP.NS", "Sammaan Capital Ltd.", "NSE"),
    ("JUBLPHARMA.NS", "Jubilant Pharmova Ltd.", "NSE"),
    ("RAINBOW.NS", "Rainbow Childrens Medicare Ltd.", "NSE"),
    ("SBFC.NS", "SBFC Finance Ltd.", "NSE"),
    ("VTL.NS", "Vardhman Textiles Ltd.", "NSE"),
    ("MANAPPURAM.NS", "Manappuram Finance Ltd.", "NSE"),
    ("TECHNOE.NS", "Techno Electric & Engineering Company Ltd.", "NSE"),
    ("THELEELA.NS", "Leela Palaces Hotels & Resorts Ltd.", "NSE"),
    ("PNBHOUSING.NS", "PNB Housing Finance Ltd.", "NSE"),
    ("HBLENGINE.NS", "HBL Engineering Ltd.", "NSE"),
    ("LTFOODS.NS", "LT Foods Ltd.", "NSE"),
    ("CRAFTSMAN.NS", "Craftsman Automation Ltd.", "NSE"),
    ("COHANCE.NS", "Cohance Lifesciences Ltd.", "NSE"),
    ("TIMKEN.NS", "Timken India Ltd.", "NSE"),
    ("ELGIEQUIP.NS", "Elgi Equipments Ltd.", "NSE"),
    ("CAMS.NS", "Computer Age Management Services Ltd.", "NSE"),
    ("KIMS.NS", "Krishna Institute of Medical Sciences Ltd.", "NSE"),
    ("INTELLECT.NS", "Intellect Design Arena Ltd.", "NSE"),
    ("INDGN.NS", "Indegene Ltd.", "NSE"),
    ("CANFINHOME.NS", "Can Fin Homes Ltd.", "NSE"),
    ("JSWCEMENT.NS", "JSW Cement Ltd.", "NSE"),
    ("TRITURBINE.NS", "Triveni Turbine Ltd.", "NSE"),
    ("NEULANDLAB.NS", "Neuland Laboratories Ltd.", "NSE"),
    ("ENGINERSIN.NS", "Engineers India Ltd.", "NSE"),
    ("SHYAMMETL.NS", "Shyam Metalics and Energy Ltd.", "NSE"),
    ("BELRISE.NS", "Belrise Industries Ltd.", "NSE"),
    ("ANGELONE.NS", "Angel One Ltd.", "NSE"),
    ("SAILIFE.NS", "Sai Life Sciences Ltd.", "NSE"),
    ("TITAGARH.NS", "Titagarh Rail Systems Ltd.", "NSE"),
    ("ASAHIINDIA.NS", "Asahi India Glass Ltd.", "NSE"),
    ("IFCI.NS", "IFCI Ltd.", "NSE"),
    ("LEMONTREE.NS", "Lemon Tree Hotels Ltd.", "NSE"),
    ("INDIAMART.NS", "Indiamart Intermesh Ltd.", "NSE"),
    ("URBANCO.NS", "Urban Company Ltd.", "NSE"),
    ("IGL.NS", "Indraprastha Gas Ltd.", "NSE"),
    ("KALYANKJIL.NS", "Kalyan Jewellers India Ltd.", "NSE"),
    ("RITES.NS", "RITES Ltd.", "NSE"),
    ("BSOFT.NS", "Birlasoft Ltd.", "NSE"),
    ("RPOWER.NS", "Reliance Power Ltd.", "NSE"),
    ("BLUEJET.NS", "Blue Jet Healthcare Ltd.", "NSE"),
    ("GRAVITA.NS", "Gravita India Ltd.", "NSE"),
    ("TENNIND.NS", "Tenneco Clean Air India Ltd.", "NSE"),
    ("PVRINOX.NS", "PVR INOX Ltd.", "NSE"),
    ("CYIENT.NS", "Cyient Ltd.", "NSE"),
    ("NAVA.NS", "Nava Ltd.", "NSE"),
    ("HONASA.NS", "Honasa Consumer Ltd.", "NSE"),
    ("NEWGEN.NS", "Newgen Software Technologies Ltd.", "NSE"),
    ("SAGILITY.NS", "Sagility Ltd.", "NSE"),
    ("WOCKPHARMA.NS", "Wockhardt Ltd.", "NSE"),
    ("ATHERENERG.NS", "Ather Energy Ltd.", "NSE"),
    ("SARDAEN.NS", "Sarda Energy and Minerals Ltd.", "NSE"),
    ("POONAWALLA.NS", "Poonawalla Fincorp Ltd.", "NSE"),
    ("SAREGAMA.NS", "Saregama India Ltd", "NSE"),
    ("BALRAMCHIN.NS", "Balrampur Chini Mills Ltd.", "NSE"),
    ("ACMESOLAR.NS", "ACME Solar Holdings Ltd.", "NSE"),
    ("EIHOTEL.NS", "EIH Ltd.", "NSE"),
    ("RHIM.NS", "RHI MAGNESITA INDIA LTD.", "NSE"),
    ("CEMPRO.NS", "Cemindia Projects Ltd.", "NSE"),
    ("AEGISVOPAK.NS", "Aegis Vopak Terminals Ltd.", "NSE"),
    ("ELECON.NS", "Elecon Engineering Co. Ltd.", "NSE"),
    ("OLAELEC.NS", "Ola Electric Mobility Ltd.", "NSE"),
    ("ARE&M.NS", "Amara Raja Energy & Mobility Ltd.", "NSE"),
    ("CHOLAHLDNG.NS", "Cholamandalam Financial Holdings Ltd.", "NSE"),
    ("EMAMILTD.NS", "Emami Ltd.", "NSE"),
    ("ATUL.NS", "Atul Ltd.", "NSE"),
    ("PWL.NS", "Physicswallah Ltd.", "NSE"),
    ("DCMSHRIRAM.NS", "DCM Shriram Ltd.", "NSE"),
    ("CDSL.NS", "Central Depository Services (India) Ltd.", "NSE"),
    ("TATACHEM.NS", "Tata Chemicals Ltd.", "NSE"),
    ("AEGISLOG.NS", "Aegis Logistics Ltd.", "NSE"),
    ("SONACOMS.NS", "Sona BLW Precision Forgings Ltd.", "NSE"),
    ("APTUS.NS", "Aptus Value Housing Finance India Ltd.", "NSE"),
    ("PTCIL.NS", "PTC Industries Ltd.", "NSE"),
    ("BRIGADE.NS", "Brigade Enterprises Ltd.", "NSE"),
    ("SIGNATURE.NS", "Signatureglobal (India) Ltd.", "NSE"),
    ("BATAINDIA.NS", "Bata India Ltd.", "NSE"),
    ("KFINTECH.NS", "Kfin Technologies Ltd.", "NSE"),
    ("DEVYANI.NS", "Devyani International Ltd.", "NSE"),
    ("HOMEFIRST.NS", "Home First Finance Company India Ltd.", "NSE"),
    ("BIKAJI.NS", "Bikaji Foods International Ltd.", "NSE"),
    ("TARIL.NS", "Transformers And Rectifiers (India) Ltd.", "NSE"),
    ("ANANDRATHI.NS", "Anand Rathi Wealth Ltd.", "NSE"),
    ("SUNTV.NS", "Sun TV Network Ltd.", "NSE"),
    ("SUMICHEM.NS", "Sumitomo Chemical India Ltd.", "NSE"),
    ("GRSE.NS", "Garden Reach Shipbuilders & Engineers Ltd.", "NSE"),
    ("CCL.NS", "CCL Products (I) Ltd.", "NSE"),
    ("BEML.NS", "BEML Ltd.", "NSE"),
    ("CHAMBLFERT.NS", "Chambal Fertilizers & Chemicals Ltd.", "NSE"),
    ("SYNGENE.NS", "Syngene International Ltd.", "NSE"),
    ("ITI.NS", "ITI Ltd.", "NSE"),
    ("MAPMYINDIA.NS", "C.E. Info Systems Ltd.", "NSE"),
    ("AFFLE.NS", "Affle 3i Ltd.", "NSE"),
    ("LATENTVIEW.NS", "Latent View Analytics Ltd.", "NSE"),
    ("TRAVELFOOD.NS", "Travel Food Services Ltd.", "NSE"),
    ("PGEL.NS", "PG Electroplast Ltd.", "NSE"),
    ("CRISIL.NS", "CRISIL Ltd.", "NSE"),
    ("NAUKRI.NS", "Info Edge (India) Ltd.", "NSE"),
    ("UTIAMC.NS", "UTI Asset Management Company Ltd.", "NSE"),

    # ── Additional mid/smallcap stocks commonly searched ───────────────────
    ("AARTI.NS", "Aarti Industries Ltd.", "NSE"),
    ("AARTIDRUGS.NS", "Aarti Drugs Ltd.", "NSE"),
    ("ABBOTINDIA.NS", "Abbott India Ltd.", "NSE"),
    ("AJANTPHARM.NS", "Ajanta Pharmaceuticals Ltd.", "NSE"),
    ("ALKEM.NS", "Alkem Laboratories Ltd.", "NSE"),
    ("APLLTD.NS", "Alembic Pharmaceuticals Ltd.", "NSE"),
    ("ASTRAMICRO.NS", "Astra Microwave Products Ltd.", "NSE"),
    ("BALAMINES.NS", "Balaji Amines Ltd.", "NSE"),
    ("BALKRISIND.NS", "Balkrishna Industries Ltd.", "NSE"),
    ("BASF.NS", "BASF India Ltd.", "NSE"),
    ("BERGEPAINT.NS", "Berger Paints India Ltd.", "NSE"),
    ("BLKASHYAP.NS", "B.L. Kashyap and Sons Ltd.", "NSE"),
    ("BOSCHLTD.NS", "Bosch Ltd.", "NSE"),
    ("CAPLIPOINT.NS", "Caplin Point Laboratories Ltd.", "NSE"),
    ("CASTROLIND.NS", "Castrol India Ltd.", "NSE"),
    ("CENTURYTEX.NS", "Century Textiles & Industries Ltd.", "NSE"),
    ("COLPAL.NS", "Colgate Palmolive (India) Ltd.", "NSE"),
    ("CUMMINSIND.NS", "Cummins India Ltd.", "NSE"),
    ("EDELWEISS.NS", "Edelweiss Financial Services Ltd.", "NSE"),
    ("EXIDEIND.NS", "Exide Industries Ltd.", "NSE"),
    ("FEDERALBNK.NS", "Federal Bank Ltd.", "NSE"),
    ("FINEORG.NS", "Fine Organic Industries Ltd.", "NSE"),
    ("GICRE.NS", "General Insurance Corporation of India", "NSE"),
    ("GLENMARK.NS", "Glenmark Pharmaceuticals Ltd.", "NSE"),
    ("GLAXO.NS", "Glaxosmithkline Pharmaceuticals Ltd.", "NSE"),
    ("GODREJIND.NS", "Godrej Industries Ltd.", "NSE"),
    ("HONAUT.NS", "Honeywell Automation India Ltd.", "NSE"),
    ("IPCALAB.NS", "Ipca Laboratories Ltd.", "NSE"),
    ("JKCEMENT.NS", "J.K. Cement Ltd.", "NSE"),
    ("JSL.NS", "Jindal Stainless Ltd.", "NSE"),
    ("JINDALSTEL.NS", "Jindal Steel Ltd.", "NSE"),
    ("KAJARIACER.NS", "Kajaria Ceramics Ltd.", "NSE"),
    ("KPRMILL.NS", "K.P.R. Mill Ltd.", "NSE"),
    ("LAURUSLABS.NS", "Laurus Labs Ltd.", "NSE"),
    ("LICHSGFIN.NS", "LIC Housing Finance Ltd.", "NSE"),
    ("LINDEINDIA.NS", "Linde India Ltd.", "NSE"),
    ("LLOYDSME.NS", "Lloyds Metals And Energy Ltd.", "NSE"),
    ("LODHA.NS", "Lodha Developers Ltd.", "NSE"),
    ("LUPIN.NS", "Lupin Ltd.", "NSE"),
    ("M&MFIN.NS", "Mahindra & Mahindra Financial Services Ltd.", "NSE"),
    ("MANKIND.NS", "Mankind Pharma Ltd.", "NSE"),
    ("MFSL.NS", "Max Financial Services Ltd.", "NSE"),
    ("MCX.NS", "Multi Commodity Exchange of India Ltd.", "NSE"),
    ("MOTILALOFS.NS", "Motilal Oswal Financial Services Ltd.", "NSE"),
    ("MPHASIS.NS", "MphasiS Ltd.", "NSE"),
    ("NATCOPHARM.NS", "NATCO Pharma Ltd.", "NSE"),
    ("NHPC.NS", "NHPC Ltd.", "NSE"),
    ("NH.NS", "Narayana Hrudayalaya Ltd.", "NSE"),
    ("NATIONALUM.NS", "National Aluminium Co. Ltd.", "NSE"),
    ("OBEROIRLTY.NS", "Oberoi Realty Ltd.", "NSE"),
    ("OFSS.NS", "Oracle Financial Services Software Ltd.", "NSE"),
    ("POLICYBZR.NS", "PB Fintech Ltd.", "NSE"),
    ("PAGEIND.NS", "Page Industries Ltd.", "NSE"),
    ("PERSISTENT.NS", "Persistent Systems Ltd.", "NSE"),
    ("PETRONET.NS", "Petronet LNG Ltd.", "NSE"),
    ("PHOENIXLTD.NS", "Phoenix Mills Ltd.", "NSE"),
    ("PIDILITIND.NS", "Pidilite Industries Ltd.", "NSE"),
    ("POLYCAB.NS", "Polycab India Ltd.", "NSE"),
    ("RBLBANK.NS", "RBL Bank Ltd.", "NSE"),
    ("SCHAEFFLER.NS", "Schaeffler India Ltd.", "NSE"),
    ("SHREECEM.NS", "Shree Cement Ltd.", "NSE"),
    ("SHRIRAMFIN.NS", "Shriram Finance Ltd.", "NSE"),
    ("SOLARINDS.NS", "Solar Industries India Ltd.", "NSE"),
    ("SUPREMEIND.NS", "Supreme Industries Ltd.", "NSE"),
    ("SUZLON.NS", "Suzlon Energy Ltd.", "NSE"),
    ("SWIGGY.NS", "Swiggy Ltd.", "NSE"),
    ("THERMAX.NS", "Thermax Ltd.", "NSE"),
    ("TITAN.NS", "Titan Company Ltd.", "NSE"),
    ("TORNTPHARM.NS", "Torrent Pharmaceuticals Ltd.", "NSE"),
    ("TORNTPOWER.NS", "Torrent Power Ltd.", "NSE"),
    ("TIINDIA.NS", "Tube Investments of India Ltd.", "NSE"),
    ("UBL.NS", "United Breweries Ltd.", "NSE"),
    ("UNITDSPR.NS", "United Spirits Ltd.", "NSE"),
    ("VBL.NS", "Varun Beverages Ltd.", "NSE"),
    ("VEDL.NS", "Vedanta Ltd.", "NSE"),
    ("VMM.NS", "Vishal Mega Mart Ltd.", "NSE"),
    ("VOLTAS.NS", "Voltas Ltd.", "NSE"),
    ("WAAREEENER.NS", "Waaree Energies Ltd.", "NSE"),
    ("YESBANK.NS", "Yes Bank Ltd.", "NSE"),
    ("ZEEL.NS", "Zee Entertainment Enterprises Ltd.", "NSE"),
    ("ZENTEC.NS", "Zen Technologies Ltd.", "NSE"),
    ("ZYDUSLIFE.NS", "Zydus Lifesciences Ltd.", "NSE"),
]


# De-duplicate static list (keep first occurrence per ticker)
_seen: set[str] = set()
_DEDUPED: list[tuple[str, str, str]] = []
for _entry in NIFTY500_STATIC:
    if _entry[0] not in _seen:
        _seen.add(_entry[0])
        _DEDUPED.append(_entry)
NIFTY500_STATIC = _DEDUPED


# ── NSE live fetch ─────────────────────────────────────────────────────────
# NSE blocks API calls from cloud IPs. We try two endpoints; fall back to
# the static list silently on any failure.
NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}
NSE_HOME = "https://www.nseindia.com"

# Ordered by preference — first URL to return ≥ 400 results wins.
# Nifty 1000 > Nifty Total Market > Nifty 500 (fallback)
_NSE_URLS = [
    "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%201000",
    "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20TOTAL%20MARKET",
    "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20MIDSMALLCAP%20400",
    "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20500",
    "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20LARGEMIDCAP%20250",
]


async def _fetch_nifty500_from_nse() -> list[tuple[str, str, str]]:
    """
    Try NSE API for live Nifty 500 constituents.
    Returns list of (ticker.NS, company_name, 'NSE') or empty list on failure.
    Logs only a single quiet warning — never raises.
    """
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            # Prime cookies
            await client.get(NSE_HOME, headers=NSE_HEADERS)

            for url in _NSE_URLS:
                try:
                    resp = await client.get(url, headers=NSE_HEADERS)
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    stocks = data.get("data", [])
                    result: list[tuple[str, str, str]] = []
                    for s in stocks:
                        sym = s.get("symbol", "").strip()
                        name = s.get("meta", {}).get("companyName") or sym
                        if sym and sym not in ("NIFTY 500", "NIFTY TOTAL MARKET",
                                               "NIFTY 1000", "NIFTY MIDSMALLCAP 400",
                                               "NIFTY LARGEMIDCAP 250"):
                            result.append((f"{sym}.NS", name, "NSE"))
                    if len(result) >= 200:
                        log.info(f"[search] NSE live: {len(result)} constituents from {url}")
                        return result
                except Exception:
                    continue

    except Exception:
        pass  # network error — handled below

    log.info("[search] NSE live fetch unavailable — using static list")
    return []


# ── In-memory ticker store ─────────────────────────────────────────────────
# Loaded once at startup; refreshed every 24 hours via background task

_TICKERS: list[tuple[str, str, str]] = list(NIFTY500_STATIC)   # seed with static


async def _refresh_ticker_list():
    global _TICKERS
    fetched = await _fetch_nifty500_from_nse()
    # Merge: NSE live data first, then add any static entries not returned by NSE
    live_syms = {t[0] for t in fetched}
    extras = [t for t in NIFTY500_STATIC if t[0] not in live_syms]
    _TICKERS = fetched + extras
    log.info(f"[search] Ticker list loaded: {len(_TICKERS)} entries")


async def _background_refresh():
    """Refresh every 24 hours."""
    while True:
        try:
            await _refresh_ticker_list()
        except Exception as e:
            log.error(f"[search] Refresh error: {e}")
        await asyncio.sleep(86400)   # 24 hours


# Called from main.py on startup
async def startup_load():
    # Kick off background refresh (Nifty 1000 live fetch + 24h loop)
    asyncio.create_task(_background_refresh())


# ── Search helpers ─────────────────────────────────────────────────────────

# Common keyword aliases → what to also search for
_ALIASES: dict[str, list[str]] = {
    "ZOMATO":   ["ETERNAL"],
    "ETERNAL":  ["ZOMATO"],
    "TATAMOTORS": ["TMCV", "TMPV"],  # demerged Oct 2025 — old symbol is dead
    "JYOTHI":   ["JYOTHYLAB"],   # common misspelling of "Jyothy Labs"
    "JYOTHILABS": ["JYOTHYLAB"],
    "FLIPKART": ["MEESHO"],
    "HDFC":     ["HDFCBANK", "HDFCLIFE", "HDFCAMC", "HDBFS", "BAJAJHFL"],
    "ICICI":    ["ICICIBANK", "ICICIGI", "ICICIPRULI", "ICICIAMC"],
    "TATA":     ["TCS", "TATASTEEL", "TATAPOWER", "TMCV", "TMPV", "TATACHEM",
                 "TATACONSUM", "TATAELXSI", "TATAINVEST", "TATATECH", "TATACOMM"],
    "ADANI":    ["ADANIENT", "ADANIGREEN", "ADANIPORTS", "ADANIPOWER", "ATGL",
                 "ADANIENSOL", "JSWENERGY"],
    "BAJAJ":    ["BAJFINANCE", "BAJAJFINSV", "BAJAJ-AUTO", "BAJAJHLDNG", "BAJAJHFL"],
    "SBI":      ["SBIN", "SBICARD", "SBILIFE", "SBFC"],
    "PHARMA":   ["SUNPHARMA", "DRREDDY", "CIPLA", "LUPIN", "DIVISLAB", "AUROPHARMA",
                 "ALKEM", "TORNTPHARM", "BIOCON", "GLAND", "IPCALAB", "MANKIND",
                 "NATCOPHARM", "ZYDUSLIFE", "LAURUSLABS", "AJANTPHARM", "EMCURE",
                 "NEULANDLAB", "CAPLIPOINT", "ERIS", "PFIZER", "GLAXO", "ABBOTINDIA"],
    "BANK":     ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK",
                 "INDUSINDBK", "BANDHANBNK", "FEDERALBNK", "YESBANK", "IDFCFIRSTB",
                 "KARURVYSYA", "CUB", "IDBI", "J&KBANK", "UCOBANK", "IOB",
                 "CENTRALBK", "RBLBANK"],
    "IT":       ["TCS", "INFY", "WIPRO", "HCLTECH", "TECHM", "COFORGE",
                 "PERSISTENT", "LTTS", "MPHASIS", "LTIM", "BSOFT", "CYIENT",
                 "NEWGEN", "LATENTVIEW", "INTELLECT", "ZENSARTECH", "SONATSOFTW"],
    "INFRA":    ["LT", "RVNL", "IRCON", "IRFC", "NBCC", "KEC", "KPIL",
                 "AFCONS", "ENGINERSIN", "TITAGARH", "GRSE", "RITES"],
    "AUTO":     ["MARUTI", "TMCV", "M&M", "BAJAJ-AUTO", "HEROMOTOCO",
                 "EICHERMOT", "TVSMOTOR", "ASHOKLEY", "MOTHERSON", "BALKRISIND",
                 "APOLLOTYRE", "CEATLTD", "JKTYRE", "FORCEMOT", "BHARATFORG"],
    "POWER":    ["NTPC", "POWERGRID", "TATAPOWER", "ADANIPOWER", "JSWENERGY",
                 "TORNTPOWER", "CESC", "NHPC", "SJVN", "JPPOWER", "RPOWER",
                 "INOXWIND", "SUZLON", "WAAREEENER", "ACMESOLAR", "EMMVEE",
                 "NTPCGREEN", "IREDA"],
    "OIL":      ["RELIANCE", "ONGC", "BPCL", "IOC", "HINDPETRO", "OIL",
                 "MRPL", "PETRONET", "GAIL", "CHENNPETRO"],
    "CEMENT":   ["ULTRACEMCO", "SHREECEM", "AMBUJACEM", "ACC", "DALBHARAT",
                 "RAMCOCEM", "JKCEMENT", "NUVOCO", "JSWCEMENT"],
    "METAL":    ["TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "SAIL",
                 "NATIONALUM", "HINDCOPPER", "NMDC", "JSL", "JINDALSTEL",
                 "JINDALSAW", "SHYAMMETL", "LLOYDSME", "GALLANTT"],
    "REALTY":   ["DLF", "GODREJPROP", "PRESTIGE", "OBEROIRLTY", "LODHA",
                 "BRIGADE", "SOBHA", "PHOENIXLTD", "SIGNATURE", "ANANTRAJ",
                 "CHALET", "LEMONTREE"],
    "INSURANCE":["HDFCLIFE", "SBILIFE", "ICICIPRULI", "ICICIGI", "STARHEALTH",
                 "MAXHEALTH", "LICI", "GICRE", "NIACL", "GODIGIT", "NIVABUPA",
                 "CANHLIFE"],
    "FMCG":     ["HINDUNILVR", "ITC", "BRITANNIA", "DABUR", "MARICO",
                 "GODREJCP", "COLPAL", "EMAMILTD", "NESTLEIND", "TATACONSUM",
                 "BIKAJI", "ZYDUSWELL"],
    "FINTECH":  ["POLICYBZR", "ANGELONE", "MOTILALOFS", "NUVAMA", "ANANDRATHI",
                 "KFINTECH", "CAMS", "MCX", "CARTRADE", "CHOICEIN"],
    "NBFC":     ["BAJFINANCE", "CHOLAFIN", "MUTHOOTFIN", "MANAPPURAM", "IIFL",
                 "CREDITACC", "FIVESTAR", "AAVAS", "CANFINHOME", "SBFC",
                 "HOMEFIRST", "PNBHOUSING", "LICHSGFIN", "POONAWALLA"],
    "SMALLCAP": ["ECLERX", "AEGISLOG", "SONACOMS", "KARURVYSYA", "KFINTECH",
                 "GRAVITA", "CONCORDBIO", "VIJAYA", "RAILTEL", "NETWEB",
                 "SYRMA", "KAYNES", "TITAGARH", "BELRISE", "GALLANTT"],
    "DEFENCE":  ["HAL", "BEL", "BDL", "MAZDOCK", "GRSE", "MIDHANI",
                 "DATAPATTNS", "ZENTEC", "SOLARINDS", "PARAS"],
    "MIDCAP":   ["CHOLAFIN", "BANDHANBNK", "PERSISTENT", "MPHASIS", "GODREJPROP",
                 "CAMS", "KFINTECH", "DELHIVERY", "NUVAMA", "KAYNES"],
    "CHEMICAL": ["DEEPAKNTR", "AARTI", "NAVINFLUOR", "FINEORG", "CLEAN",
                 "ANURAS", "TATACHEM", "SUMICHEM", "FLUOROCHEM", "PIIND",
                 "BAYERCROP", "PCBL"],
    "TEXTILE":  ["TRIDENT", "VTL", "WELSPUNLIV", "KPRMILL", "RAYMOND"],
    "SHIPPING": ["SCI", "GESHIP", "MAZDOCK", "COCHINSHIP"],
    "LOGISTICS":["DELHIVERY", "BLUEDART", "CONCOR", "REDINGTON", "TRAVELFOOD",
                 "AEGISLOG"],
    "HOSPITAL": ["APOLLOHOSP", "FORTIS", "MAXHEALTH", "MEDANTA", "NH",
                 "KIMS", "RAINBOW", "ASTERDM", "VIJAYA"],
    "EV":       ["OLAELEC", "ATHERENERG", "TATAPOWER", "OLECTRA", "JBMA",
                 "MOTHERSON", "SONACOMS"],
    "SOLAR":    ["ACMESOLAR", "WAAREEENER", "EMMVEE", "PREMIERENE", "INOXWIND",
                 "SUZLON", "ADANIGREEN", "NTPCGREEN"],
}


def _score(ticker: str, name: str, q_words: list[str]) -> int:
    """
    Multi-word relevance score. Each word in the query is scored independently.
    All words must contribute positively for a result to be returned.
    """
    sym_clean  = ticker.replace(".NS", "").replace(".BO", "").upper()
    name_upper = name.upper()

    # Build searchable tokens from name (words, acronym)
    name_words = name_upper.split()
    acronym    = "".join(w[0] for w in name_words if w.isalpha())

    total = 0
    for q in q_words:
        word_score = 0

        # ── Symbol matches ──────────────────────────────────────────
        if sym_clean == q:
            word_score += 100
        elif sym_clean.startswith(q):
            word_score += 65
        elif q in sym_clean:
            word_score += 35

        # ── Acronym match (e.g. "HDFC" matches "HDFC Bank Ltd") ────
        if acronym == q:
            word_score += 55
        elif acronym.startswith(q) and len(q) >= 2:
            word_score += 30

        # ── Company name matches ────────────────────────────────────
        if name_upper.startswith(q):
            word_score += 60
        elif name_words and name_words[0] == q:
            word_score += 50
        elif re.search(r'\b' + re.escape(q) + r'\b', name_upper):
            word_score += 28
        elif q in name_upper:
            word_score += 12

        # If this word contributes nothing, kill the whole result
        # (unless it's a short stop-word like AND, OF, &)
        if word_score == 0 and len(q) > 2 and q not in ("AND", "OF", "THE", "LTD", "LTD.", "&"):
            return 0

        total += word_score

    # Bonus: more words matched = tighter result
    if len(q_words) > 1:
        total += 20
        # Phrase bonus: all query words forming the name's opening phrase
        # ("TATA MOTORS" → "Tata Motors Ltd.") is the strongest name signal —
        # it must outrank a single-word symbol-prefix match (TATASTEEL).
        if name_upper.startswith(" ".join(q_words)):
            total += 90

    return total


@router.get("/api/search", response_model=list[SearchSuggestion])
async def search_tickers(q: str = Query(..., min_length=1, max_length=60)):
    q_clean   = q.strip().upper()
    q_stripped = re.sub(r'\.(NS|BO)$', '', q_clean).strip()

    # Split into words, remove noise — also split on camelCase / run-together words
    # e.g. "Shaktipumps" → "SHAKTI PUMPS", "JyothiLabs" → "JYOTHI LABS"
    # Strategy: insert space before uppercase letters that follow lowercase, then split
    spaced = re.sub(r'([a-z])([A-Z])', r'\1 \2', q.strip())   # camelCase
    spaced = re.sub(r'([A-Z]{2,})([A-Z][a-z])', r'\1 \2', spaced)  # e.g. GNFCLtd → GNFC Ltd
    q_expanded = spaced.strip().upper()

    raw_words = [w for w in re.split(r'[\s,&]+', q_expanded) if w]

    # Deduplicate while preserving order
    seen_w: set[str] = set()
    q_words = [w for w in raw_words if not (w in seen_w or seen_w.add(w))]  # type: ignore[func-returns-value]

    cache_key = f"search2:{q_stripped}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    # Expand aliases — collect extra symbols to boost, remembering the position
    # each symbol appeared at (earlier in the list = stronger intent, used as a
    # tie-break among equally-matching aliases, e.g. "HDFC" → HDFCBANK first)
    alias_boosts: dict[str, int] = {}
    for word in q_words:
        for idx, alias_sym in enumerate(_ALIASES.get(word, [])):
            if alias_sym not in alias_boosts or idx < alias_boosts[alias_sym]:
                alias_boosts[alias_sym] = idx

    # Score every ticker — try all word subsets for run-together queries
    scored: list[tuple[int, tuple[str, str, str]]] = []
    for entry in _TICKERS:
        sym_clean_entry = entry[0].replace(".NS", "").replace(".BO", "").upper()

        # Try full word list first; if 0, try each word individually (handles run-together)
        s = _score(entry[0], entry[1], q_words)
        if s == 0:
            candidates = [w for w in q_words if len(w) >= 3]
            s = max((_score(entry[0], entry[1], [w]) for w in candidates), default=0)
            # All-lowercase run-together name ("shaktipumps"): camelCase split
            # produced nothing, so try every split point of the single token
            # and keep the best two-word match
            if s == 0 and len(q_words) == 1 and len(q_words[0]) >= 6:
                token = q_words[0]
                for i in range(3, len(token) - 2):
                    sc = _score(entry[0], entry[1], [token[:i], token[i:]])
                    if sc > s:
                        s = sc

        # Alias boost: reward aliases on top of a real text match. Only when the
        # ticker has NO textual relation to any query word (rename-style alias,
        # e.g. "ZOMATO" → ETERNAL) do we surface it via its own symbol score —
        # otherwise category aliases ("BANK" → 18 banks) would all outrank
        # genuine matches on a query-independent score.
        if sym_clean_entry in alias_boosts:
            if s > 0:
                s += 40 - min(alias_boosts[sym_clean_entry], 8)
            elif all(
                _score(entry[0], entry[1], [w]) == 0
                for w in q_words if len(w) >= 2
            ):
                s = _score(entry[0], entry[1], [sym_clean_entry]) + 40

        if s > 0:
            scored.append((s, entry))

    scored.sort(key=lambda x: -x[0])
    results = [
        SearchSuggestion(ticker=t, name=n, exchange=e)
        for _, (t, n, e) in scored[:12]
    ]

    # Last resort: yfinance direct lookup for unlisted tickers
    if not results:
        import yfinance as yf
        base = q_words[0] if q_words else q_stripped
        candidates = [f"{base}.NS", f"{base}.BO", q_clean]
        for candidate in candidates:
            try:
                info = yf.Ticker(candidate).info
                if info and info.get("longName") and info.get("quoteType") == "EQUITY":
                    results = [SearchSuggestion(
                        ticker=candidate,
                        name=info.get("longName", candidate),
                        exchange=info.get("exchange", "NSE"),
                    )]
                    break
            except Exception:
                continue

    cache.set(cache_key, results, ttl=3600)
    return results
