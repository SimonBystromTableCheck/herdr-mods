#!/usr/bin/perl
# GIT_SEQUENCE_EDITOR for scripted history edits.
#   HERDR_MODE=replace: "pick A" becomes "$HERDR_OP A"; HERDR_A may list several
#                       commits, comma separated (a range: squash / fixup / drop).
#   HERDR_MODE=swap:    swaps the adjacent "pick A" / "pick B" lines.
#   HERDR_MODE=move:    HERDR_A lists a block of adjacent picks, HERDR_B the pick
#                       right before or after it; B moves to the block's other side
#                       (the block moves one commit up or down).
use strict; use warnings;
my $file = shift or die "no todo file\n";
open my $in, '<', $file or die "$!\n"; local $/; my $todo = <$in>; close $in;
my ($mode, $ca, $cb, $op) = map { $ENV{$_} // '' } qw(HERDR_MODE HERDR_A HERDR_B HERDR_OP);
if ($mode eq 'replace') {
  for my $s (split /,/, $ca) { $todo =~ s/^pick ($s\w*)/$op $1/m or die "commit $s is not in the rebase todo\n"; }
}
elsif ($mode eq 'swap') { $todo =~ s/^(pick $ca\w*[^\n]*\n)(pick $cb\w*[^\n]*\n)/$2$1/m or die "commits $ca and $cb are not adjacent in the rebase todo\n"; }
elsif ($mode eq 'move') {
  my @lines = split /(?<=\n)/, $todo;
  my $at = sub { my $s = shift; my ($i) = grep { $lines[$_] =~ /^pick $s/ } 0 .. $#lines; defined $i ? $i : die "commit $s is not in the rebase todo\n" };
  my @block = sort { $a <=> $b } map { $at->($_) } split /,/, $ca;
  my ($lo, $hi) = ($block[0], $block[-1]);
  die "the commits aren't next to each other in the rebase todo\n" if $hi - $lo != $#block;
  my $n = $at->($cb);
  my $moved = splice(@lines, $n, 1);
  if ($n == $hi + 1) { splice(@lines, $lo, 0, $moved); }
  elsif ($n == $lo - 1) { splice(@lines, $hi, 0, $moved); }
  else { die "commit $cb isn't next to the block in the rebase todo\n"; }
  $todo = join '', @lines;
}
else { die "unknown HERDR_MODE '$mode'\n"; }
open my $out, '>', $file or die "$!\n"; print $out $todo; close $out;
