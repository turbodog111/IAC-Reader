#!/usr/bin/env python3
"""Install the August 31 studied bank and September 1 reading queue."""

from __future__ import annotations

import json
from pathlib import Path

from study.reading_queue_20260901 import LESSONS


ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "corpus" / "master_clues.jsonl"
LESSON_FILE = ROOT / "study" / "lessons.json"
CLUES: list[dict] = []
COMPLETED_LESSON_IDS = {"POL-030", "POL-031"}
PENDING_LESSONS = [lesson for lesson in LESSONS if lesson["id"] not in COMPLETED_LESSON_IDS]


def add(anchor: str, answerline: str, tier: int, *texts: str) -> None:
    start = 1 + sum(1 for clue in CLUES if clue["study_anchor"] == anchor)
    for offset, text in enumerate(texts):
        CLUES.append({
            "study_anchor": anchor,
            "answerline": answerline,
            "clue_id": f"{anchor}-C{start + offset:02d}",
            "tier": tier,
            "clue": text,
            "core": tier == 4,
            "source": "compact lesson and IAC corpus audit, 2026-08-31",
            "status": "active",
        })


add("POL-030", "John Winthrop", 6,
    "This Puritan signed the 1629 Cambridge Agreement, which made emigration conditional on transferring a chartered company's government to New England.",
    "This colonial leader owned the trading vessel Blessing of the Bay and participated with William Pynchon in the fur trade.",
    "This governor's namesake son founded New London, led the Saybrook project, and secured Connecticut's royal charter of 1662.",
    "This magistrate distinguished lawless natural liberty from morally ordered civil or federal liberty in a 1645 speech.",
    "This leader's journal covering 1630 through 1649 was later published as The History of New England.")
add("POL-030", "John Winthrop", 5,
    "This preacher warned that failure would make his community a story and a by-word after stating that the party loving reaps love again.",
    "This magistrate privately warned Roger Williams of an imminent arrest, allowing the dissenter to flee Massachusetts.",
    "This governor alternated in office with John Endecott, Thomas Dudley, Henry Vane, and Richard Bellingham.",
    "This leader crossed aboard the Arbella as head of the much larger 1630 migration that shifted settlement toward Boston.",
    "This magistrate returned to power during the Antinomian Controversy and supported the banishment of Anne Hutchinson.")
add("POL-030", "John Winthrop", 4,
    "This Puritan described his Massachusetts community through the biblical image of a city upon a hill.",
    "This leader wrote the sermon A Model of Christian Charity during the migration of 1630.",
    "This politician served twelve annual terms across four separate periods as governor of Massachusetts Bay.",
    "This colonial leader headed the fleet that brought hundreds of Puritan settlers to New England in 1630.",
    "This Massachusetts Bay governor became the colony's defining early political leader after John Endecott.")

add("POL-031", "Warren G. Harding", 6,
    "This politician purchased the Marion Star in 1884 and built it with the financial and circulation work of Florence Kling.",
    "This president signed the Phipps Act for a connected federal highway system while his administration commissioned the defense-oriented Pershing Map.",
    "This president endorsed political and economic equality for Black Americans in a 1921 Birmingham speech while still accepting social separation.",
    "This president commuted Eugene Debs's Espionage Act sentence on Christmas 1921 and then received the socialist at the White House.",
    "This president confronted a Veterans Bureau scandal in which Charles Forbes manipulated hospital contracts and diverted government supplies.")
add("POL-031", "Warren G. Harding", 5,
    "This candidate's manager Harry Daugherty predicted that a deadlocked convention would select him in a smoke-filled room.",
    "This president's secretary of state opened the Washington Naval Conference with a ship-scrapping proposal that produced a five-five-three capital-ship ratio.",
    "This president signed the Budget and Accounting Act, which created the Bureau of the Budget and the General Accounting Office.",
    "This president's Ohio Gang included Jess Smith, whose influence-peddling network operated from the Little Green House on K Street.",
    "This president became the first sitting chief executive to visit Alaska during the 1923 Voyage of Understanding before dying in San Francisco.")
add("POL-031", "Warren G. Harding", 4,
    "This Republican defeated James Cox in 1920 after conducting a front-porch campaign from Marion, Ohio.",
    "This president promised a return to normalcy after World War One, labor unrest, and the First Red Scare.",
    "This president's administration was damaged when Albert Fall secretly leased the Teapot Dome and Elk Hills petroleum reserves.",
    "This twenty-ninth president died in 1923 and was succeeded by Calvin Coolidge.",
    "This president's administration became synonymous with the Ohio Gang and the Teapot Dome scandal.")


add("POL-026", "Aaron Burr", 6,
    "This man married Theodosia Prevost after studying theology under future president John Witherspoon.",
    "This politician converted a water company into the Manhattan Company, an ancestor of JPMorgan Chase.",
    "This attorney joined Alexander Hamilton in defending Levi Weeks in the Manhattan Well murder trial.",
    "This former vice president organized a western venture around Harman Blennerhassett's Ohio River island and the Bastrop lands.",
    "This conspirator sent James Wilkinson a cipher letter that became evidence at a Richmond treason trial.")
add("POL-026", "Aaron Burr", 5,
    "This New Yorker helped organize the political society that evolved into Tammany Hall.",
    "This candidate tied Thomas Jefferson in 1800 before James Bayard helped resolve the House balloting.",
    "This politician challenged Morgan Lewis after Charles D. Cooper publicized a supposedly despicable opinion about him.",
    "This vice president presided with conspicuous fairness over Samuel Chase's impeachment trial.",
    "This defendant was acquitted after John Marshall required two witnesses to the same overt act of treason.")
add("POL-026", "Aaron Burr", 4,
    "This man served as Thomas Jefferson's first vice president.",
    "This politician fatally wounded Alexander Hamilton in an 1804 duel at Weehawken.",
    "This New Yorker was accused of plotting an independent western empire after leaving the vice presidency.",
    "This politician's daughter Theodosia Alston disappeared aboard the schooner Patriot.",
    "This founder was the grandfather of abolitionist educator John Pierre through Mary Emmons.")

add("IND-001", "Ousamequin / Massasoit", 6,
    "This sachem ruled from the Pokanoket center at Sowams and appeared with his brother Quadequina.",
    "This leader used the warrior Hobbamock while confronting Corbitant's challenge at Nemasket.",
    "This sachem reportedly recovered from a grave illness after Edward Winslow treated and fed him in 1623.",
    "This leader warned Plymouth through Edward Winslow about a threat connected with the Wessagusset settlement.",
    "This sachem is represented by a Cyrus Dallin statue overlooking Plymouth Harbor.")
add("IND-001", "Ousamequin / Massasoit", 5,
    "This leader negotiated through Samoset and Tisquantum before meeting the English settlers in March 1621.",
    "This sachem concluded a mutual-defense agreement that promised the return of stolen goods and weapons.",
    "This leader arrived at a harvest gathering with about ninety men who contributed five deer.",
    "This sachem maintained peace with Plymouth while balancing rivalry with the Narragansett.",
    "This leader's friendship helped Roger Williams obtain refuge and land after his banishment.")
add("IND-001", "Ousamequin / Massasoit", 4,
    "This Wampanoag sachem formed a long alliance with Plymouth Colony.",
    "This leader attended the gathering later mythologized as the First Thanksgiving.",
    "This sachem was the father of Wamsutta, also called Alexander, and Metacom, also called Philip.",
    "This leader's death preceded the collapse in relations that culminated in King Philip's War.",
    "This Native leader allied with William Bradford's colony shortly after the Mayflower passengers arrived.")

add("MISC-048", "Brook Farm", 6,
    "This community named its buildings the Hive, the Nest, the Eyrie, and Pilgrim House.",
    "This experiment attracted Isaac Hecker before he converted to Catholicism and founded the Paulist Fathers.",
    "This association's uninsured Phalanstery burned in 1846 shortly before the project collapsed under debt.",
    "This site's later Camp Andrew trained the Second Massachusetts Infantry under Robert Gould Shaw.",
    "This property later belonged to James Freeman Clarke and eventually became a National Historic Site.")
add("MISC-048", "Brook Farm", 5,
    "This West Roxbury cooperative was founded in 1841 by George and Sophia Ripley.",
    "This community adopted Charles Fourier's associationism after Albert Brisbane promoted his ideas.",
    "This experiment published the reform journal The Harbinger.",
    "This community supported itself partly through a respected coeducational school.",
    "This association sought to combine intellectual work with agriculture and manual labor.")
add("MISC-048", "Brook Farm", 4,
    "This Massachusetts transcendentalist communal experiment lasted from 1841 to 1847.",
    "This community briefly included Nathaniel Hawthorne, whose experience inspired The Blithedale Romance.",
    "This experiment was associated with the Transcendental Club, although Margaret Fuller was only a visitor.",
    "This utopian community stood in West Roxbury near Boston.",
    "This cooperative failed after a costly fire and mounting debts.")

add("LAW-004", "Louis Dembitz Brandeis", 6,
    "This jurist received his unusual middle name in honor of a maternal uncle who was a legal scholar.",
    "This lawyer coauthored The Right to Privacy with Samuel D. Warren in 1890.",
    "This public-interest attorney represented a federal whistleblower during the Ballinger-Pinchot controversy.",
    "This mediator helped create the Protocol of Peace in the New York garment industry.",
    "This justice distinguished a captive streetcar audience in Packer Corporation v. Utah.")
add("LAW-004", "Louis Dembitz Brandeis", 5,
    "This lawyer's namesake brief used evidence assembled by Josephine Goldmark in Muller v. Oregon.",
    "This critic of concentrated finance wrote Other People's Money and How the Bankers Use It.",
    "This justice called states laboratories in a dissent from New State Ice Company v. Liebmann.",
    "This jurist's Ashwander concurrence organized rules of constitutional avoidance.",
    "This American Zionist leader clashed with Chaim Weizmann over organization and fundraising.")
add("LAW-004", "Louis Dembitz Brandeis", 4,
    "This Wilson appointee became the first Jewish justice of the Supreme Court in 1916.",
    "This justice's Olmstead dissent described privacy as the right to be let alone.",
    "This jurist wrote the majority opinion rejecting federal general common law in Erie Railroad v. Tompkins.",
    "This People's Lawyer attacked monopolies, interlocking directorates, and the money trust.",
    "This justice joined Harlan Fiske Stone and Benjamin Cardozo in the liberal Three Musketeers.")

add("POL-027", "Benjamin Franklin", 6,
    "This printer predicted astrologer Titan Leeds's death and then insisted that later denials came from an impostor.",
    "This scientist and cousin Timothy Folger produced an early chart of the Gulf Stream.",
    "This observer connected the dry haze of 1783 with an Icelandic volcanic eruption.",
    "This inventor created a glass armonica played by Mozart and Beethoven.",
    "This Pennsylvania leader denounced the Paxton Boys and helped protect Native refugees in Philadelphia.")
add("POL-027", "Benjamin Franklin", 5,
    "This teenager attacked his brother's newspaper establishment through letters signed Silence Dogood.",
    "This founder's Junto inspired the Library Company, Union Fire Company, and American Philosophical Society.",
    "This colonial agent endured Alexander Wedderburn's Cockpit denunciation over the Hutchinson letters.",
    "This diplomat cultivated French support from Passy and helped secure the 1778 alliance.",
    "This delegate proposed the Albany Plan after publishing the Join, or Die cartoon.")
add("POL-027", "Benjamin Franklin", 4,
    "This printer wrote Poor Richard's Almanack under the name Richard Saunders.",
    "This experimenter used a kite to demonstrate the electrical nature of lightning.",
    "This elder statesman signed the Declaration, the Treaty of Paris, and the Constitution.",
    "This diplomat helped negotiate the peace ending the American Revolution.",
    "This Philadelphia founder is depicted on the one-hundred-dollar bill.")

add("POL-028", "Grover Cleveland", 6,
    "This president secretly underwent cancer surgery aboard the yacht Oneida.",
    "This candidate benefited when the forged Murchison Letter embarrassed the British minister Lionel Sackville-West.",
    "This president sent James Blount to investigate the overthrow of Hawaii's Queen Liliuokalani.",
    "This politician acknowledged supporting Maria Halpin and her son during the 1884 campaign.",
    "This president vetoed the Texas Seed Bill as an improper federal charity.")
add("POL-028", "Grover Cleveland", 5,
    "This Bourbon Democrat attracted Republican Mugwumps after the Mulligan letters damaged James Blaine.",
    "This candidate survived the phrase Rum, Romanism, and Rebellion in the 1884 campaign.",
    "This president signed the Dawes Act and the Interstate Commerce Act.",
    "This administration sold bonds through a syndicate associated with J. P. Morgan during the Panic of 1893.",
    "This president invoked the Monroe Doctrine in Richard Olney's Venezuelan boundary dispute with Britain.")
add("POL-028", "Grover Cleveland", 4,
    "This president served two nonconsecutive terms numbered the twenty-second and twenty-fourth presidencies.",
    "This president sent federal troops against the Pullman Strike despite Governor John Peter Altgeld's objections.",
    "This bachelor president married Frances Folsom in the White House.",
    "This Democrat lost the 1888 electoral vote to Benjamin Harrison despite winning the popular vote.",
    "This president returned to office by defeating Harrison in an 1892 rematch.")

add("MIL-012", "Mad Anthony Wayne", 6,
    "This commander trained the Legion of the United States at Legionville near Pittsburgh.",
    "This general escaped Cornwallis at Green Spring by ordering an aggressive charge rather than a retreat.",
    "This politician's disputed Georgia residency nearly cost him his congressional seat.",
    "This officer's son later divided his remains between Presque Isle and a Pennsylvania family cemetery.",
    "This commander employed former captive William Wells as chief scout and interpreter.")
add("MIL-012", "Mad Anthony Wayne", 5,
    "This officer demanded a court-martial to clear his reputation after the Paoli surprise.",
    "This commander ordered unloaded muskets and a bayonet assault during the nighttime capture of Stony Point.",
    "This general built Fort Defiance at the junction of the Auglaize and Maumee rivers.",
    "This commander strengthened Fort Recovery on the site of St. Clair's earlier defeat.",
    "This Pennsylvania officer served at Trois-Rivieres, Ticonderoga, and Monmouth before commanding in Georgia.")
add("MIL-012", "Mad Anthony Wayne", 4,
    "This general defeated a Native confederacy at the Battle of Fallen Timbers in 1794.",
    "This commander negotiated the Treaty of Greenville the following year.",
    "This Revolutionary general's aggressive reputation produced a famous nickname suggesting insanity.",
    "This officer commanded the reorganized Legion of the United States under George Washington.",
    "This general gave his name to an Indiana fort and the city that grew around it.")

add("FOR-001", "Emilio Aguinaldo", 6,
    "This leader began as a municipal official in Cavite el Viejo and headed the Magdalo council.",
    "This revolutionary defeated Andres Bonifacio at the Tejeros Convention amid rivalry with the Magdiwang faction.",
    "This commander's brother Crispulo died covering his retreat at Perez-Dasmarinas after fighting near Zapote Bridge.",
    "This exile accepted Pedro Paterno's Pact of Biak-na-Bato and departed for Hong Kong.",
    "This fugitive was captured at Palanan after Frederick Funston used forged messages and Macabebe Scouts.")
add("FOR-001", "Emilio Aguinaldo", 5,
    "This leader's June 1898 declaration was read by Ambrosio Rianzares Bautista at Kawit.",
    "This president sent Felipe Agoncillo abroad while Julian Felipe composed a national anthem.",
    "This leader headed the Malolos Republic with Apolinario Mabini as a principal adviser.",
    "This president became implicated in the assassination of rival general Antonio Luna.",
    "This aging revolutionary lost the 1935 presidential election to Manuel Quezon.")
add("FOR-001", "Emilio Aguinaldo", 4,
    "This revolutionary became the first president of the Philippines.",
    "This leader returned from Hong Kong aboard the USS McCulloch after meeting George Dewey.",
    "This president led Filipino resistance after the United States acquired the islands from Spain.",
    "This captured leader swore allegiance to the United States in 1901.",
    "This figure proclaimed Philippine independence from Spain on June 12, 1898.")

add("POL-029", "John McCain", 6,
    "This politician was born at Coco Solo Naval Air Station to the son and grandson of four-star admirals.",
    "This senator was buried at the Naval Academy Cemetery beside Admiral Chuck Larson.",
    "This committee chairman exposed Jack Abramoff's exploitation of Native American tribes.",
    "This veteran worked with John Kerry on POW-MIA investigations and normalization with Vietnam.",
    "This prisoner survived the Plantation camp with help from Medal of Honor recipient Bud Day.")
add("POL-029", "John McCain", 5,
    "This aviator escaped an A-4 Skyhawk during the 1967 USS Forrestal fire caused by an accidental Zuni launch.",
    "This senator was the only Republican among the Keating Five.",
    "This legislator joined the Gang of 14 on judicial filibusters and the Gang of Eight on immigration.",
    "This hawkish senator formed the Three Amigos with Joe Lieberman and Lindsey Graham.",
    "This candidate rode the Straight Talk Express before a South Carolina smear targeted his adopted daughter Bridget.")
add("POL-029", "John McCain", 4,
    "This Vietnam prisoner refused early release while his father commanded U.S. forces in the Pacific.",
    "This senator sponsored the 2002 Bipartisan Campaign Reform Act with Russ Feingold.",
    "This 2008 Republican presidential nominee selected Sarah Palin as his running mate.",
    "This senator cast a dramatic thumbs-down vote against the skinny repeal of the Affordable Care Act.",
    "This Arizona senator succeeded Barry Goldwater and died from glioblastoma in 2018.")


def main() -> None:
    replaced = {clue["study_anchor"] for clue in CLUES}
    existing = [
        (line, json.loads(line)) for line in CORPUS.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    kept_lines = [line for line, clue in existing if clue["study_anchor"] not in replaced]
    new_lines = [json.dumps(clue, ensure_ascii=True) for clue in CLUES]
    CORPUS.write_text(
        "\n".join(kept_lines + new_lines) + "\n",
        encoding="utf-8",
    )
    LESSON_FILE.write_text(
        json.dumps({"lessons": PENDING_LESSONS}, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Installed {len(CLUES)} clues across {len(replaced)} studied answerlines.")
    print(f"Installed {len(PENDING_LESSONS)} compact lessons for the next reading queue.")


if __name__ == "__main__":
    main()
