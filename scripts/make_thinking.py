"""Write static/thinking.js: 1000 distinct "thinking..." phrases.

    python scripts/make_thinking.py

Hand-written lines first, then verb + object pairs, shuffled with a fixed seed
so the output is the same every run.
"""
import json
import os
import random

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'static', 'thinking.js')

WHOLE = """
Thinking
Consulting the scrolls
Weaving hand signs
Shedding old assumptions
Reading between the lines
Following the thread
Connecting the dots
Checking the sources
Sharpening the blade
Gathering chakra
Untangling the question
Sketching an answer
Weighing the evidence
Slithering through the details
Summoning a reply
Asking the owls
Waking the librarian
Dusting off the encyclopedia
Bribing the neurons
Herding stray thoughts
Counting to infinity, twice
Rebooting intuition
Polishing the crystal ball
Feeding the hamster wheel
Unfolding the map
Climbing the knowledge tree
Diving into the archives
Tuning the antenna
Calibrating the hunch
Warming up the cortex
Shuffling index cards
Flipping through footnotes
Interrogating the data
Cross-examining the facts
Peer-reviewing myself
Arguing with my inner skeptic
Letting the idea simmer
Stirring the thought soup
Brewing a fresh pot of logic
Kneading the argument
Proofing the reasoning
Baking a well-done answer
Seasoning with nuance
Plating the response
Folding origami thoughts
Knitting the narrative
Untying knots in the logic
Lacing up the logic boots
Stretching before the sprint
Doing mental push-ups
Jogging through the literature
Sprinting past the obvious
Taking the scenic route
Mapping the unknown
Charting a course
Reading the stars
Asking the moon for advice
Listening to the wind
Watching the leaves fall
Counting the rings of the tree
Measuring twice
Cutting once
Triple-checking the decimals
Carrying the one
Squaring the circle, almost
Rounding up the variables
Corralling the constants
Balancing the equations
Tidying the error bars
Fitting the curve
Smoothing the noise
Finding the signal
Tuning out the static
Zooming in
Zooming out
Changing the lens
Adjusting the focus
Turning it upside down
Looking at it sideways
Holding it up to the light
Shaking the snow globe
Rattling the idea box
Opening the vault
Picking the lock on the problem
Finding the hidden door
Following the breadcrumbs
Tracing the footprints
Dusting for fingerprints
Interviewing the suspects
Reviewing the security tapes
Cracking the case
Solving for x
Solving for y, just in case
Dividing and conquering
Thinking in first principles
Going back to basics
Starting from scratch
Building from the ground up
Laying the foundations
Raising the scaffolding
Hammering out details
Sanding the rough edges
Painting the big picture
Adding the fine print
Signing the masterpiece
Rolling the dice, carefully
Playing chess with the question
Thinking three moves ahead
Castling the king
Sacrificing a pawn of doubt
Checkmating confusion
Spinning the globe
Visiting the library of Alexandria
Borrowing from Newton
Asking Curie for a second opinion
Channelling Feynman
Doodling in the margins
Scribbling on the whiteboard
Erasing the whiteboard
Drawing a better diagram
Labelling the axes
Choosing the right units
Converting the units back
Checking the dimensions
Simplifying the fraction
Factoring the polynomial
Integrating by parts
Differentiating fact from fiction
Taking the limit
Approaching from both sides
Converging slowly
Converging faster now
Iterating once more
Running the simulation
Running it again, for luck
Collecting more samples
Averaging the opinions
Removing the outliers, politely
Normalising expectations
Lighting a candle
Opening a window for fresh ideas
Watering the idea garden
Pruning the tangents
Planting a seed of insight
Waiting for it to sprout
Harvesting the insight
Grinding the coffee beans
Pouring a strong espresso
Sipping green tea
Taking a deep breath
Meditating on it
Finding inner peace, and the answer
Stretching the imagination
Chasing a good idea
Catching it by the tail
Bottling the lightning
Taming the thunder
Riding the brainwave
Surfing the data stream
Paddling upstream
Crossing the bridge of logic
Building a better bridge
Checking the bridge holds
Climbing the last hill
Reaching the summit
Planting the flag
Enjoying the view, briefly
Heading back down with answers
Sending the carrier pigeon
Waiting for the pigeon
The pigeon has returned
Decoding the message
Translating from Ancient Greek
Consulting the Rosetta Stone
Reading the fine print
Reading it again, slower
Highlighting the good parts
Bookmarking the page
Writing a sticky note
Losing the sticky note
Finding the sticky note
Filing it under 'important'
Alphabetising the thoughts
Sorting by relevance
Ranking the candidates
Shortlisting the best bits
Picking the winner
Double-checking the winner
Clearing the throat
Choosing the right words
Swapping in a better word
Trimming the fat
Cutting the jargon
Keeping it honest
Making it make sense
Putting it in plain words
Lining up the bullet points
Straightening the paragraphs
Fixing the punctuation
Adding a dash of clarity
Removing a dash of confusion
Mixing metaphors carefully
Unmixing the metaphors
Almost there
Nearly ready
Putting on the finishing touches
Tying the bow
Wrapping it up
Hold on, this is a good one
One more thought
Okay, two more thoughts
Pondering the imponderable
Contemplating the cosmos
Having a eureka moment
Running to tell everyone
Remembering to put on clothes first
Drafting the reply
Redrafting the reply
Approving the final draft
""".strip().splitlines()

VERBS = """
Polishing
Untangling
Weighing
Sharpening
Brewing
Decoding
Mapping
Folding
Assembling
Stacking
Juggling
Sifting
Distilling
Weaving
Tuning
Charting
Sorting
Balancing
Testing
Unboxing
Dusting off
Stitching
Sketching
Measuring
Calibrating
Shuffling
Gathering
Inspecting
Interrogating
Rearranging
Summoning
Kneading
Herding
Simmering
Untying
""".strip().splitlines()

OBJECTS = """
the hypotheses
the footnotes
the citations
the evidence
the variables
the ideas
the arguments
the clues
the equations
the error bars
the scrolls
the hand signs
the data points
the loose threads
the big picture
the tiny details
the assumptions
the counterexamples
the first principles
the analogies
the timelines
the definitions
the diagrams
the unknowns
the logic gears
the thought bubbles
the possibilities
the edge cases
the margins
the patterns
the answer
""".strip().splitlines()


def main(out):
    whole = list(dict.fromkeys(p.strip() for p in WHOLE if p.strip()))
    pairs = [v + ' ' + o for v in VERBS for o in OBJECTS]
    rng = random.Random(1000)
    rng.shuffle(pairs)
    phrases = list(dict.fromkeys(whole + pairs))[:1000]
    assert len(phrases) == 1000, len(phrases)
    rng.shuffle(phrases)
    body = ',\n'.join('        ' + json.dumps(p) for p in phrases)
    js = (
        "/* Kusanagi -- the phrases shown while an answer is being thought up.\n"
        " *\n"
        " * 1000 of them, so a long session rarely sees one twice. Generated by\n"
        " * scripts/make_thinking.py; edit that and re-run rather than this file.\n"
        " */\n"
        "(function () {\n"
        "    'use strict';\n"
        "\n"
        "    window.Kusanagi = window.Kusanagi || {};\n"
        "    window.Kusanagi.THINKING = [\n"
        + body + ",\n"
        "    ];\n"
        "})();\n"
    )
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    print('wrote %d phrases (%d hand-written) to %s' % (len(phrases), len(whole), out))


if __name__ == '__main__':
    main(OUT)
